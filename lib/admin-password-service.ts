import type { ActiveSessionResult } from "../infra/postgres/auth-repository.ts";
import { isValidEmail, normalizeEmail } from "./auth-contracts.ts";
import {
  AUTH_RATE_LIMIT_POLICIES,
  SESSION_TTL_SECONDS,
  createPasswordHash,
  createOpaqueToken,
  createSecretRateLimitBucketKey,
  isAcceptablePassword,
  isPasswordHash,
  sha256Hex,
  verifyPassword,
  type RateLimitDecision,
  type RateLimitPolicy,
} from "./auth-security.ts";
import type { AdminRole } from "../infra/postgres/admin-repository.ts";

export interface AdminPasswordRateLimiter {
  takeRateLimit(input: {
    scope: string;
    bucketHash: string;
    policy: RateLimitPolicy;
    now: Date;
  }): Promise<RateLimitDecision>;
}

export interface AdminPasswordRepository {
  findPasswordIdentity(email: string): Promise<
    { userId: string; role: AdminRole; passwordHash: string | null } | null
  >;
  openPasswordSession(input: {
    userId: string;
    sessionTokenHash: string;
    sessionExpiresAt: Date;
    ipAddress: string | null;
    userAgent: string | null;
    now: Date;
  }): Promise<{ role: AdminRole } | null>;
  findCredential(userId: string): Promise<{ role: AdminRole; passwordHash: string | null } | null>;
  changePassword(input: {
    userId: string;
    passwordHash: string;
    keepSessionTokenHash: string;
    now: Date;
  }): Promise<{ status: "changed"; revokedSessions: number } | { status: "not_admin" }>;
}

export class AdminPasswordFlowError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;

  constructor(status: number, code: string, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "AdminPasswordFlowError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type AdminPasswordService = ReturnType<typeof createAdminPasswordService>;

function rejectedCredentials() {
  return new AdminPasswordFlowError(401, "ADMIN_CREDENTIALS_REJECTED", "E-posta veya parola geçersiz.");
}

/**
 * Password sign-in and password change for the operations console.
 *
 * The live verifier is the one stored next to the membership; the environment
 * hash is only the bootstrap credential for the first operator, and it stops
 * being usable for an account as soon as that account sets its own password.
 * Nothing here ever persists or logs the plaintext.
 */
export function createAdminPasswordService(dependencies: {
  bootstrapEmail: string;
  bootstrapPasswordHash: string;
  rateLimitSecret: string;
  rateLimiter: AdminPasswordRateLimiter;
  repository: AdminPasswordRepository;
  auth: { authenticateSession(rawToken: string): Promise<ActiveSessionResult | null> };
  now?: () => Date;
  crypto?: Crypto;
  onOperationalError?: (error: unknown) => void;
}) {
  const bootstrapEmail = normalizeEmail(dependencies.bootstrapEmail);
  const cryptoSource = dependencies.crypto ?? globalThis.crypto;
  const now = dependencies.now ?? (() => new Date());
  if (!isValidEmail(bootstrapEmail) || !isPasswordHash(dependencies.bootstrapPasswordHash)) {
    throw new TypeError("Admin parola yapılandırması geçersiz.");
  }
  if (new TextEncoder().encode(dependencies.rateLimitSecret).byteLength < 32) {
    throw new TypeError("Admin oran sınırlama sırrı en az 32 bayt olmalıdır.");
  }

  function report(error: unknown) {
    try { dependencies.onOperationalError?.(error); } catch { /* Observability must not alter auth. */ }
  }

  async function enforceRateLimit(discriminator: string, attemptedAt: Date) {
    const bucketHash = await createSecretRateLimitBucketKey(
      dependencies.rateLimitSecret,
      "admin-password",
      discriminator,
      cryptoSource,
    );

    let decision: RateLimitDecision;
    try {
      decision = await dependencies.rateLimiter.takeRateLimit({
        scope: "admin-password",
        bucketHash,
        policy: AUTH_RATE_LIMIT_POLICIES.adminPassword,
        now: attemptedAt,
      });
    } catch (error) {
      report(error);
      throw new AdminPasswordFlowError(503, "ADMIN_AUTH_UNAVAILABLE", "Admin giriş hizmeti şu anda kullanılamıyor.");
    }
    if (!decision.allowed) {
      throw new AdminPasswordFlowError(
        429,
        "RATE_LIMITED",
        "Çok fazla deneme yapıldı. Bir süre sonra yeniden deneyin.",
        Math.max(1, Math.ceil(decision.retryAfterMs / 1_000)),
      );
    }
  }

  /** The stored verifier wins; the environment one only covers an account that has never set its own. */
  function effectiveHash(email: string, storedHash: string | null) {
    if (storedHash) return storedHash;
    return email === bootstrapEmail ? dependencies.bootstrapPasswordHash : null;
  }

  return {
    async signIn(input: {
      email: string;
      password: string;
      clientDiscriminator: string;
      ipAddress?: string | null;
      userAgent?: string | null;
    }) {
      const attemptedAt = now();
      await enforceRateLimit(input.clientDiscriminator, attemptedAt);

      const email = isValidEmail(input.email) ? normalizeEmail(input.email) : "";
      let identity: { userId: string; role: AdminRole; passwordHash: string | null } | null = null;
      if (email) {
        try {
          identity = await dependencies.repository.findPasswordIdentity(email);
        } catch (error) {
          report(error);
          throw new AdminPasswordFlowError(503, "ADMIN_AUTH_UNAVAILABLE", "Admin giriş hizmeti şu anda kullanılamıyor.");
        }
      }

      // PBKDF2 runs even for an unknown address so a missing account is not a cheap timing oracle.
      const usableHash = identity ? effectiveHash(email, identity.passwordHash) : null;
      const passwordMatches = await verifyPassword(
        input.password,
        usableHash ?? dependencies.bootstrapPasswordHash,
        cryptoSource,
      );
      if (!passwordMatches || !identity || !usableHash) throw rejectedCredentials();

      const sessionToken = await createOpaqueToken(cryptoSource);
      const sessionExpiresAt = new Date(attemptedAt.getTime() + SESSION_TTL_SECONDS * 1_000);
      let opened: { role: AdminRole } | null;
      try {
        opened = await dependencies.repository.openPasswordSession({
          userId: identity.userId,
          sessionTokenHash: sessionToken.tokenHash,
          sessionExpiresAt,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent?.trim().slice(0, 512) || null,
          now: attemptedAt,
        });
      } catch (error) {
        report(error);
        throw new AdminPasswordFlowError(503, "ADMIN_AUTH_UNAVAILABLE", "Admin giriş hizmeti şu anda kullanılamıyor.");
      }
      if (!opened) throw rejectedCredentials();

      return {
        sessionToken: sessionToken.rawToken,
        expiresAt: sessionExpiresAt,
        role: opened.role,
      };
    },

    /**
     * Replaces the caller's own password.
     *
     * The current password is required even though the session is already
     * authenticated: a borrowed browser tab should not be able to lock the real
     * operator out of the console.
     */
    async changePassword(input: {
      rawToken: string;
      currentPassword: unknown;
      newPassword: unknown;
    }) {
      const attemptedAt = now();
      let session: ActiveSessionResult | null;
      try {
        session = await dependencies.auth.authenticateSession(input.rawToken);
      } catch (error) {
        report(error);
        throw new AdminPasswordFlowError(503, "ADMIN_AUTH_UNAVAILABLE", "Admin giriş hizmeti şu anda kullanılamıyor.");
      }
      if (!session) {
        throw new AdminPasswordFlowError(401, "SESSION_REQUIRED", "Bu işlem için giriş yapılmalıdır.");
      }
      await enforceRateLimit(`change:${session.userId}`, attemptedAt);

      let credential: { role: AdminRole; passwordHash: string | null } | null;
      try {
        credential = await dependencies.repository.findCredential(session.userId);
      } catch (error) {
        report(error);
        throw new AdminPasswordFlowError(503, "ADMIN_AUTH_UNAVAILABLE", "Admin giriş hizmeti şu anda kullanılamıyor.");
      }
      if (!credential) {
        throw new AdminPasswordFlowError(403, "ADMIN_REQUIRED", "Bu alan yalnızca yetkili operasyon ekibine açıktır.");
      }

      const email = normalizeEmail(session.email);
      const currentHash = effectiveHash(email, credential.passwordHash);
      if (!currentHash) {
        throw new AdminPasswordFlowError(
          409,
          "ADMIN_PASSWORD_NOT_SET",
          "Bu hesap için parola girişi tanımlı değil.",
        );
      }
      const currentMatches = typeof input.currentPassword === "string" &&
        await verifyPassword(input.currentPassword, currentHash, cryptoSource);
      if (!currentMatches) {
        throw new AdminPasswordFlowError(401, "CURRENT_PASSWORD_REJECTED", "Mevcut parola doğrulanamadı.");
      }
      if (!isAcceptablePassword(input.newPassword)) {
        throw new AdminPasswordFlowError(
          400,
          "WEAK_PASSWORD",
          "Yeni parola 8-128 karakter olmalı ve baştaki veya sondaki boşluk içermemelidir.",
        );
      }
      if (await verifyPassword(input.newPassword, currentHash, cryptoSource)) {
        throw new AdminPasswordFlowError(400, "PASSWORD_UNCHANGED", "Yeni parola mevcut paroladan farklı olmalıdır.");
      }

      const passwordHash = await createPasswordHash(input.newPassword, { crypto: cryptoSource });
      const keepSessionTokenHash = await sha256Hex(input.rawToken, cryptoSource);
      let outcome: { status: "changed"; revokedSessions: number } | { status: "not_admin" };
      try {
        outcome = await dependencies.repository.changePassword({
          userId: session.userId,
          passwordHash,
          keepSessionTokenHash,
          now: attemptedAt,
        });
      } catch (error) {
        report(error);
        throw new AdminPasswordFlowError(503, "ADMIN_AUTH_UNAVAILABLE", "Parola şu anda değiştirilemedi.");
      }
      if (outcome.status !== "changed") {
        throw new AdminPasswordFlowError(403, "ADMIN_REQUIRED", "Bu alan yalnızca yetkili operasyon ekibine açıktır.");
      }

      return {
        changed: true,
        revokedSessions: outcome.revokedSessions,
        message: outcome.revokedSessions > 0
          ? `Parola değiştirildi. Diğer ${outcome.revokedSessions} oturum kapatıldı.`
          : "Parola değiştirildi.",
      };
    },
  };
}
