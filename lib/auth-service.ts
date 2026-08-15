import {
  CURRENT_CONSENT_VERSION,
  DEFAULT_AUTH_RETURN_TO,
  createRegistrationIntent,
  isSafeReturnPath,
  isValidEmail,
  normalizeEmail,
} from "./auth-contracts.ts";
import {
  AUTH_RATE_LIMIT_POLICIES,
  SESSION_TTL_SECONDS,
  createOpaqueToken,
  createSecretRateLimitBucketKey,
  sha256Hex,
  type RateLimitDecision,
  type RateLimitPolicy,
} from "./auth-security.ts";
import type {
  ActiveSessionResult,
  CreateMagicLinkChallengeInput,
  MagicLinkExchangeInput,
  MagicLinkExchangeResult,
} from "../infra/postgres/auth-repository.ts";

export const MAGIC_LINK_TTL_MS = 10 * 60_000;
export const MAGIC_LINK_ACCEPTED_MESSAGE =
  "Adres uygunsa tek kullanımlık giriş bağlantısı gönderilecektir.";

const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export class AuthFlowError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AuthFlowError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface MagicLinkRepository {
  takeRateLimit(input: {
    scope: string;
    bucketHash: string;
    policy: RateLimitPolicy;
    now: Date;
  }): Promise<RateLimitDecision>;
  createMagicLinkChallenge(input: CreateMagicLinkChallengeInput): Promise<string>;
  markMagicLinkDelivered(challengeId: string, now: Date): Promise<boolean>;
  markMagicLinkDeliveryFailed(challengeId: string, now: Date): Promise<boolean>;
  exchangeMagicLink(input: MagicLinkExchangeInput): Promise<MagicLinkExchangeResult | null>;
  findActiveSession(tokenHash: string, now: Date): Promise<ActiveSessionResult | null>;
}

export interface MagicLinkMailer {
  sendMagicLink(input: {
    to: string;
    link: string;
    purpose: "signin" | "verify_email";
    expiresAt: Date;
  }): Promise<void>;
}

export type AuthServiceDependencies = {
  repository: MagicLinkRepository;
  mailer: MagicLinkMailer;
  appOrigin: string;
  rateLimitSecret: string;
  now?: () => Date;
  crypto?: Crypto;
  onOperationalError?: (error: unknown) => void;
};

export type RequestMagicLinkInput = {
  mode: "signin" | "register";
  email: string;
  displayName?: string | null;
  returnTo?: string | null;
  clientDiscriminator: string;
  requestedIp?: string | null;
};

export type ConsumeMagicLinkInput = {
  rawToken: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

function safeAppOrigin(value: string) {
  const url = new URL(value);
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new TypeError("APP_ORIGIN yalnızca origin içermelidir.");
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new TypeError("APP_ORIGIN HTTPS kullanmalıdır.");
  }
  return url.origin;
}

function normalizedRequest(input: RequestMagicLinkInput) {
  const returnTo = isSafeReturnPath(input.returnTo) ? input.returnTo : DEFAULT_AUTH_RETURN_TO;
  if (input.mode === "register") {
    const registration = createRegistrationIntent({
      displayName: input.displayName ?? "",
      email: input.email,
      returnTo,
    });
    if (!registration) {
      throw new AuthFlowError(400, "INVALID_IDENTITY", "Ad veya e-posta bilgisi geçersiz.");
    }
    return {
      purpose: "verify_email" as const,
      email: registration.email,
      displayName: registration.displayName,
      consentVersion: CURRENT_CONSENT_VERSION,
      returnTo: registration.returnTo,
    };
  }

  if (!isValidEmail(input.email)) {
    throw new AuthFlowError(400, "INVALID_IDENTITY", "E-posta bilgisi geçersiz.");
  }
  return {
    purpose: "signin" as const,
    email: normalizeEmail(input.email),
    displayName: null,
    consentVersion: null,
    returnTo,
  };
}

function reportOperationalError(dependencies: AuthServiceDependencies, error: unknown) {
  try {
    dependencies.onOperationalError?.(error);
  } catch {
    // Observability must never change the authentication outcome.
  }
}

export function createAuthService(dependencies: AuthServiceDependencies) {
  const appOrigin = safeAppOrigin(dependencies.appOrigin);
  const now = dependencies.now ?? (() => new Date());
  const cryptoSource = dependencies.crypto ?? globalThis.crypto;

  return {
    async requestMagicLink(input: RequestMagicLinkInput) {
      const request = normalizedRequest(input);
      const requestedAt = now();
      const bucketHash = await createSecretRateLimitBucketKey(
        dependencies.rateLimitSecret,
        "magic-link",
        `${request.email}|${input.clientDiscriminator}`,
        cryptoSource,
      );
      const rateLimit = await dependencies.repository.takeRateLimit({
        scope: "magic-link",
        bucketHash,
        policy: AUTH_RATE_LIMIT_POLICIES.magicLink,
        now: requestedAt,
      });
      if (!rateLimit.allowed) {
        const retryAfterSeconds = Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000));
        throw new AuthFlowError(
          429,
          "RATE_LIMITED",
          "Çok fazla deneme yapıldı. Bir süre sonra yeniden deneyin.",
          retryAfterSeconds,
        );
      }

      const { rawToken, tokenHash } = await createOpaqueToken(cryptoSource);
      const expiresAt = new Date(requestedAt.getTime() + MAGIC_LINK_TTL_MS);
      let challengeId: string;
      try {
        challengeId = await dependencies.repository.createMagicLinkChallenge({
          purpose: request.purpose,
          email: request.email,
          tokenHash,
          expiresAt,
          returnTo: request.returnTo,
          displayName: request.displayName,
          consentVersion: request.consentVersion,
          requestedIp: input.requestedIp ?? null,
        });
      } catch (error) {
        reportOperationalError(dependencies, error);
        throw new AuthFlowError(503, "AUTH_UNAVAILABLE", "Giriş hizmeti şu anda kullanılamıyor.");
      }

      const link = new URL("/giris/dogrula", appOrigin);
      link.searchParams.set("token", rawToken);
      try {
        await dependencies.mailer.sendMagicLink({
          to: request.email,
          link: link.href,
          purpose: request.purpose,
          expiresAt,
        });
        const markedDelivered = await dependencies.repository.markMagicLinkDelivered(challengeId, now());
        if (!markedDelivered) throw new Error("Magic-link teslim durumu güncellenemedi.");
      } catch (error) {
        reportOperationalError(dependencies, error);
        try {
          await dependencies.repository.markMagicLinkDeliveryFailed(challengeId, now());
        } catch (revocationError) {
          reportOperationalError(dependencies, revocationError);
        }
      }

      return {
        accepted: true as const,
        code: "MAGIC_LINK_ACCEPTED" as const,
        message: MAGIC_LINK_ACCEPTED_MESSAGE,
      };
    },

    async consumeMagicLink(input: ConsumeMagicLinkInput) {
      if (!OPAQUE_TOKEN.test(input.rawToken)) {
        throw new AuthFlowError(400, "INVALID_OR_EXPIRED_LINK", "Bağlantı geçersiz veya süresi dolmuş.");
      }
      const consumedAt = now();
      const challengeTokenHash = await sha256Hex(input.rawToken, cryptoSource);
      const sessionToken = await createOpaqueToken(cryptoSource);
      const exchange = await dependencies.repository.exchangeMagicLink({
        challengeTokenHash,
        sessionTokenHash: sessionToken.tokenHash,
        sessionExpiresAt: new Date(consumedAt.getTime() + SESSION_TTL_SECONDS * 1000),
        now: consumedAt,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent?.trim().slice(0, 512) || null,
      });
      if (!exchange) {
        throw new AuthFlowError(400, "INVALID_OR_EXPIRED_LINK", "Bağlantı geçersiz veya süresi dolmuş.");
      }

      return {
        sessionToken: sessionToken.rawToken,
        userId: exchange.userId,
        sessionId: exchange.sessionId,
        returnTo: isSafeReturnPath(exchange.returnTo) ? exchange.returnTo : DEFAULT_AUTH_RETURN_TO,
      };
    },

    async authenticateSession(rawToken: string) {
      if (!OPAQUE_TOKEN.test(rawToken)) return null;
      const tokenHash = await sha256Hex(rawToken, cryptoSource);
      return dependencies.repository.findActiveSession(tokenHash, now());
    },
  };
}
