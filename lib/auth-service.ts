import {
  CURRENT_CONSENT_VERSION,
  DEFAULT_AUTH_RETURN_TO,
  createRegistrationIntent,
  isSafeReturnPath,
  isValidDisplayName,
  isValidEmail,
  normalizeDisplayName,
  normalizeEmail,
} from "./auth-contracts.ts";
import {
  AUTH_RATE_LIMIT_POLICIES,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SESSION_TTL_SECONDS,
  createDeviceDraftImportCommand,
  createOpaqueToken,
  createPasswordHash,
  createPkcePair,
  createSecretRateLimitBucketKey,
  isAcceptablePassword,
  sha256Hex,
  verifyPassword,
  type DeviceDraftImportCommand,
  type RateLimitDecision,
  type RateLimitPolicy,
} from "./auth-security.ts";
import { CATALOG_VERSION } from "./catalog.ts";
import type {
  ActiveSessionResult,
  CreateMagicLinkChallengeInput,
  CreateOAuthStateInput,
  MagicLinkExchangeInput,
  MagicLinkExchangeResult,
  OAuthExchangeInput,
  OAuthStateResult,
  RotateSessionInput,
  RotateSessionResult,
} from "../infra/postgres/auth-repository.ts";
import {
  buildDiscordAuthorizeUrl,
  exchangeDiscordCode,
  fetchDiscordIdentity,
  type DiscordConfig,
} from "../infra/oauth/discord.ts";

/**
 * A verifier no password can match, used when the address has no account.
 *
 * Comparing against a real-shaped hash keeps the wrong-address and
 * wrong-password paths equally expensive, so response time does not reveal who
 * has an account. The salt and digest are fixed constants, not a secret.
 */
const PLACEHOLDER_PASSWORD_HASH =
  "pbkdf2-sha256$310000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

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

export interface SessionRepository {
  rotateSession(input: RotateSessionInput): Promise<RotateSessionResult | null>;
  revokeSession(sessionId: string, actorUserId: string, now: Date): Promise<boolean>;
  revokeAllUserSessions(actorUserId: string, now: Date): Promise<number>;
  revokeSessionFamilyOnReuse(
    tokenHash: string,
    now: Date,
  ): Promise<{ familyId: string; userId: string; revokedSessions: number } | null>;
}

export interface OAuthRepository {
  createOAuthState(input: CreateOAuthStateInput): Promise<string>;
  consumeOAuthState(input: {
    provider: "discord";
    stateHash: string;
    now: Date;
  }): Promise<OAuthStateResult | null>;
  exchangeOAuthAccount(input: OAuthExchangeInput): Promise<MagicLinkExchangeResult | null>;
}

export interface DraftRepository {
  importDeviceDraft(
    command: DeviceDraftImportCommand,
    catalogVersion: string,
  ): Promise<{ serverDraftId: string; replay: boolean }>;
}

export interface PasswordRepository {
  registerWithPassword(input: {
    email: string;
    displayName: string;
    passwordHash: string;
    sessionTokenHash: string;
    sessionExpiresAt: Date;
    ipAddress: string | null;
    userAgent: string | null;
    now: Date;
  }): Promise<MagicLinkExchangeResult | { taken: true } | null>;
  findPasswordAccount(email: string): Promise<
    { userId: string; passwordHash: string; displayName: string } | null
  >;
  openPasswordAccountSession(input: {
    userId: string;
    sessionTokenHash: string;
    sessionExpiresAt: Date;
    ipAddress: string | null;
    userAgent: string | null;
    now: Date;
  }): Promise<MagicLinkExchangeResult | null>;
}

export type AuthRepository = MagicLinkRepository & SessionRepository & OAuthRepository & DraftRepository
  & PasswordRepository;

export interface MagicLinkMailer {
  sendMagicLink(input: {
    to: string;
    link: string;
    purpose: "signin" | "verify_email";
    expiresAt: Date;
  }): Promise<void>;
}

export type AuthServiceDependencies = {
  repository: AuthRepository;
  /** Null when no mail provider is configured; magic-link calls then fail loudly. */
  mailer: MagicLinkMailer | null;
  /** Null when Discord credentials are absent; Discord calls then fail loudly. */
  discord?: DiscordConfig | null;
  appOrigin: string;
  rateLimitSecret: string;
  now?: () => Date;
  crypto?: Crypto;
  onOperationalError?: (error: unknown) => void;
};

export const OAUTH_STATE_TTL_MS = 10 * 60_000;

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
  clientDiscriminator?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type SessionCommandInput = {
  rawToken: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type ImportDeviceDraftInput = {
  rawToken: string;
  importKey: string;
  draft: unknown;
};

export type PasswordCredentialsInput = {
  email: unknown;
  password: unknown;
  displayName?: unknown;
  clientDiscriminator: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type StartDiscordSignInInput = {
  returnTo?: string | null;
  clientDiscriminator: string;
  requestedIp?: string | null;
};

export type CompleteDiscordSignInInput = {
  state: string;
  code: string;
  clientDiscriminator: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/** One public answer for every Discord failure, so probes learn nothing. */
function discordRejected() {
  return new AuthFlowError(400, "DISCORD_SIGN_IN_REJECTED", "Discord girişi tamamlanamadı.");
}

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

  async function authenticateSession(rawToken: string) {
    if (!OPAQUE_TOKEN.test(rawToken)) return null;

    const tokenHash = await sha256Hex(rawToken, cryptoSource);
    const session = await dependencies.repository.findActiveSession(tokenHash, now());
    if (session) return session;

    // No live session matched. If the value is a token we already replaced, it
    // was captured after rotation, so the whole family is treated as burned.
    try {
      await dependencies.repository.revokeSessionFamilyOnReuse(tokenHash, now());
    } catch (error) {
      reportOperationalError(dependencies, error);
    }
    return null;
  }

  /** Peppered, persistent bucket; the raw identity never reaches the database. */
  async function takeRateLimit(scope: string, discriminator: string, policy: RateLimitPolicy, at: Date) {
    const bucketHash = await createSecretRateLimitBucketKey(
      dependencies.rateLimitSecret,
      scope,
      discriminator,
      cryptoSource,
    );

    let decision: RateLimitDecision;
    try {
      decision = await dependencies.repository.takeRateLimit({ scope, bucketHash, policy, now: at });
    } catch (error) {
      // An unreachable database is an outage, not a client mistake: answering
      // 503 keeps the failure honest and retryable instead of a bare 500.
      reportOperationalError(dependencies, error);
      throw new AuthFlowError(503, "AUTH_UNAVAILABLE", "Giriş hizmeti şu anda kullanılamıyor.");
    }

    if (decision.allowed) return;

    throw new AuthFlowError(
      429,
      "RATE_LIMITED",
      "Çok fazla deneme yapıldı. Bir süre sonra yeniden deneyin.",
      Math.max(1, Math.ceil(decision.retryAfterMs / 1000)),
    );
  }

  function requireDiscord() {
    if (!dependencies.discord) {
      throw new AuthFlowError(503, "AUTH_NOT_CONFIGURED", "Discord girişi henüz etkin değil.");
    }
    return dependencies.discord;
  }

  return {
    async requestMagicLink(input: RequestMagicLinkInput) {
      if (!dependencies.mailer) {
        throw new AuthFlowError(503, "AUTH_NOT_CONFIGURED", "Canlı e-posta girişi henüz etkin değil.");
      }
      const request = normalizedRequest(input);
      const requestedAt = now();
      await takeRateLimit(
        "magic-link",
        `${request.email}|${input.clientDiscriminator}`,
        AUTH_RATE_LIMIT_POLICIES.magicLink,
        requestedAt,
      );

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
      // Caps link guessing per client before a hash is ever compared.
      await takeRateLimit(
        "magic-link-callback",
        input.clientDiscriminator ?? "unknown",
        AUTH_RATE_LIMIT_POLICIES.callback,
        consumedAt,
      );
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

    /**
     * Opens a Discord sign-in: stores a single-use state with its PKCE verifier
     * and returns the authorize URL. The verifier never leaves the server.
     */
    async startDiscordSignIn(input: StartDiscordSignInInput) {
      const discord = requireDiscord();
      const startedAt = now();
      await takeRateLimit(
        "discord-start",
        input.clientDiscriminator,
        AUTH_RATE_LIMIT_POLICIES.discordStart,
        startedAt,
      );

      const state = await createOpaqueToken(cryptoSource);
      const pkce = await createPkcePair(cryptoSource);
      await dependencies.repository.createOAuthState({
        provider: "discord",
        stateHash: state.tokenHash,
        codeVerifier: pkce.verifier,
        returnTo: isSafeReturnPath(input.returnTo) ? input.returnTo : DEFAULT_AUTH_RETURN_TO,
        expiresAt: new Date(startedAt.getTime() + OAUTH_STATE_TTL_MS),
        requestedIp: input.requestedIp ?? null,
      });

      return {
        authorizeUrl: buildDiscordAuthorizeUrl(discord, {
          state: state.rawToken,
          codeChallenge: pkce.challenge,
        }),
      };
    },

    /**
     * Completes the callback. Every failure mode answers with the same public
     * error so a probe cannot tell a bad state from a bad code or an
     * unverified provider address.
     */
    async completeDiscordSignIn(input: CompleteDiscordSignInInput) {
      const discord = requireDiscord();
      const completedAt = now();
      await takeRateLimit(
        "discord-callback",
        input.clientDiscriminator,
        AUTH_RATE_LIMIT_POLICIES.callback,
        completedAt,
      );

      if (!OPAQUE_TOKEN.test(input.state) || !input.code) throw discordRejected();

      const stateHash = await sha256Hex(input.state, cryptoSource);
      const stored = await dependencies.repository.consumeOAuthState({
        provider: "discord",
        stateHash,
        now: completedAt,
      });
      if (!stored) throw discordRejected();

      let identity: Awaited<ReturnType<typeof fetchDiscordIdentity>>;
      try {
        const accessToken = await exchangeDiscordCode(discord, {
          code: input.code,
          codeVerifier: stored.codeVerifier,
        });
        identity = await fetchDiscordIdentity(discord, accessToken);
      } catch (error) {
        reportOperationalError(dependencies, error);
        throw discordRejected();
      }
      if (!identity) throw discordRejected();

      const sessionToken = await createOpaqueToken(cryptoSource);
      const exchange = await dependencies.repository.exchangeOAuthAccount({
        provider: "discord",
        providerAccountId: identity.providerAccountId,
        email: identity.email,
        displayName: identity.displayName,
        sessionTokenHash: sessionToken.tokenHash,
        sessionExpiresAt: new Date(completedAt.getTime() + SESSION_TTL_SECONDS * 1000),
        now: completedAt,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent?.trim().slice(0, 512) || null,
      });
      if (!exchange) throw discordRejected();

      return {
        sessionToken: sessionToken.rawToken,
        userId: exchange.userId,
        returnTo: isSafeReturnPath(stored.returnTo) ? stored.returnTo : DEFAULT_AUTH_RETURN_TO,
      };
    },

    authenticateSession,

    /** Issues a successor token for the same session family and invalidates the presented one. */
    /**
     * Opens an account with an email and a password, and signs it in at once.
     *
     * The closed beta deliberately skips address verification: the customer
     * types a password and is in. That is a real weakening — an address nobody
     * proved they own can hold servers — so it is recorded in the audit log and
     * called out in the docs rather than quietly assumed.
     */
    async registerWithPassword(input: PasswordCredentialsInput) {
      const attemptedAt = now();
      await takeRateLimit("password", input.clientDiscriminator, AUTH_RATE_LIMIT_POLICIES.password, attemptedAt);

      const email = typeof input.email === "string" && isValidEmail(input.email)
        ? normalizeEmail(input.email)
        : "";
      const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
      if (!email) throw new AuthFlowError(400, "INVALID_EMAIL", "E-posta adresi geçersiz.");
      if (!isValidDisplayName(displayName)) {
        throw new AuthFlowError(400, "INVALID_DISPLAY_NAME", "Görünen ad 2-60 karakter olmalıdır.");
      }
      if (!isAcceptablePassword(input.password)) {
        throw new AuthFlowError(
          400,
          "WEAK_PASSWORD",
          `Parola ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} karakter olmalı ve baştaki veya sondaki boşluk içermemelidir.`,
        );
      }

      const passwordHash = await createPasswordHash(input.password, { crypto: cryptoSource });
      const sessionToken = await createOpaqueToken(cryptoSource);
      let result: Awaited<ReturnType<PasswordRepository["registerWithPassword"]>>;
      try {
        result = await dependencies.repository.registerWithPassword({
          email,
          displayName: normalizeDisplayName(displayName),
          passwordHash,
          sessionTokenHash: sessionToken.tokenHash,
          sessionExpiresAt: new Date(attemptedAt.getTime() + SESSION_TTL_SECONDS * 1_000),
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent?.trim().slice(0, 512) || null,
          now: attemptedAt,
        });
      } catch (error) {
        reportOperationalError(dependencies, error);
        throw new AuthFlowError(503, "AUTH_UNAVAILABLE", "Kayıt şu anda tamamlanamıyor.");
      }

      if (result && "taken" in result) {
        throw new AuthFlowError(409, "EMAIL_TAKEN", "Bu e-posta ile bir hesap zaten var. Giriş yapmayı deneyin.");
      }
      if (!result) throw new AuthFlowError(503, "AUTH_UNAVAILABLE", "Kayıt şu anda tamamlanamıyor.");

      return { sessionToken: sessionToken.rawToken, returnTo: result.returnTo, displayName: result.displayName };
    },

    /** Signs in an existing password account; a wrong address and a wrong password answer alike. */
    async signInWithPassword(input: PasswordCredentialsInput) {
      const attemptedAt = now();
      await takeRateLimit("password", input.clientDiscriminator, AUTH_RATE_LIMIT_POLICIES.password, attemptedAt);

      const email = typeof input.email === "string" && isValidEmail(input.email)
        ? normalizeEmail(input.email)
        : "";
      let account: Awaited<ReturnType<PasswordRepository["findPasswordAccount"]>> = null;
      if (email) {
        try {
          account = await dependencies.repository.findPasswordAccount(email);
        } catch (error) {
          reportOperationalError(dependencies, error);
          throw new AuthFlowError(503, "AUTH_UNAVAILABLE", "Giriş şu anda yapılamıyor.");
        }
      }

      // PBKDF2 runs even for an unknown address so a missing account is not a
      // cheap way to enumerate who has one.
      const candidateHash = account?.passwordHash ?? PLACEHOLDER_PASSWORD_HASH;
      const password = typeof input.password === "string" ? input.password : "";
      const matches = await verifyPassword(password, candidateHash, cryptoSource);
      if (!matches || !account) {
        throw new AuthFlowError(401, "CREDENTIALS_REJECTED", "E-posta veya parola geçersiz.");
      }

      const sessionToken = await createOpaqueToken(cryptoSource);
      let result: MagicLinkExchangeResult | null;
      try {
        result = await dependencies.repository.openPasswordAccountSession({
          userId: account.userId,
          sessionTokenHash: sessionToken.tokenHash,
          sessionExpiresAt: new Date(attemptedAt.getTime() + SESSION_TTL_SECONDS * 1_000),
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent?.trim().slice(0, 512) || null,
          now: attemptedAt,
        });
      } catch (error) {
        reportOperationalError(dependencies, error);
        throw new AuthFlowError(503, "AUTH_UNAVAILABLE", "Giriş şu anda yapılamıyor.");
      }
      if (!result) throw new AuthFlowError(401, "CREDENTIALS_REJECTED", "E-posta veya parola geçersiz.");

      return { sessionToken: sessionToken.rawToken, returnTo: result.returnTo, displayName: result.displayName };
    },

    async rotateSession(input: SessionCommandInput) {
      const session = await authenticateSession(input.rawToken);
      if (!session) return null;

      const rotatedAt = now();
      const nextToken = await createOpaqueToken(cryptoSource);
      const rotated = await dependencies.repository.rotateSession({
        sessionId: session.sessionId,
        actorUserId: session.userId,
        sessionTokenHash: nextToken.tokenHash,
        sessionExpiresAt: new Date(rotatedAt.getTime() + SESSION_TTL_SECONDS * 1000),
        now: rotatedAt,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent?.trim().slice(0, 512) || null,
      });
      if (!rotated) return null;

      return { sessionToken: nextToken.rawToken, expiresAt: rotated.expiresAt };
    },

    async signOut(input: SessionCommandInput) {
      const session = await authenticateSession(input.rawToken);
      if (!session) return { signedOut: false, revokedSessions: 0 };

      const revoked = await dependencies.repository.revokeSession(session.sessionId, session.userId, now());
      return { signedOut: revoked, revokedSessions: revoked ? 1 : 0 };
    },

    /**
     * Moves one device draft into the signed-in account.
     *
     * The import key makes this idempotent: a repeated call with the same draft
     * returns the original row, and the same key with a different draft is a
     * conflict rather than a silent overwrite.
     */
    async importDeviceDraft(input: ImportDeviceDraftInput) {
      const session = await authenticateSession(input.rawToken);
      if (!session) {
        throw new AuthFlowError(401, "SESSION_REQUIRED", "Bu işlem için giriş yapılmalıdır.");
      }

      const command = await createDeviceDraftImportCommand({
        actorUserId: session.userId,
        importKey: input.importKey,
        draft: input.draft,
      });
      if (!command) {
        throw new AuthFlowError(400, "INVALID_DRAFT", "Sunucu taslağı veya aktarım anahtarı geçersiz.");
      }

      const result = await dependencies.repository.importDeviceDraft(command, CATALOG_VERSION);
      return {
        code: result.replay ? ("DRAFT_ALREADY_IMPORTED" as const) : ("DRAFT_IMPORTED" as const),
        serverDraftId: result.serverDraftId,
      };
    },

    async signOutEverywhere(input: SessionCommandInput) {
      const session = await authenticateSession(input.rawToken);
      if (!session) return { signedOut: false, revokedSessions: 0 };

      const revokedSessions = await dependencies.repository.revokeAllUserSessions(session.userId, now());
      return { signedOut: true, revokedSessions };
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
