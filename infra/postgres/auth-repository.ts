import {
  evaluateFixedWindowRateLimit,
  type DeviceDraftImportCommand,
  type RateLimitDecision,
  type RateLimitPolicy,
  type RateLimitState,
} from "../../lib/auth-security.ts";

export type SqlRow = Record<string, unknown>;

export type SqlQueryResult<Row extends SqlRow> = {
  rows: Row[];
  rowCount?: number | null;
};

export interface SqlExecutor {
  query<Row extends SqlRow = SqlRow>(text: string, values?: readonly unknown[]): Promise<SqlQueryResult<Row>>;
}

export interface TransactionalSqlExecutor extends SqlExecutor {
  transaction<T>(callback: (transaction: SqlExecutor) => Promise<T>): Promise<T>;
}

export type CreateMagicLinkChallengeInput = {
  purpose: "signin" | "verify_email";
  email: string;
  tokenHash: string;
  expiresAt: Date;
  returnTo: string;
  displayName: string | null;
  consentVersion: string | null;
  requestedIp: string | null;
};

export type MagicLinkExchangeInput = {
  challengeTokenHash: string;
  sessionTokenHash: string;
  sessionExpiresAt: Date;
  now: Date;
  ipAddress: string | null;
  userAgent: string | null;
};

export type MagicLinkExchangeResult = {
  userId: string;
  sessionId: string;
  sessionFamilyId: string;
  email: string;
  displayName: string;
  returnTo: string;
};

export type ActiveSessionResult = {
  sessionId: string;
  sessionFamilyId: string;
  userId: string;
  email: string;
  displayName: string;
  expiresAt: Date;
};

export type CreateOAuthStateInput = {
  provider: "discord";
  stateHash: string;
  codeVerifier: string;
  returnTo: string;
  expiresAt: Date;
  requestedIp: string | null;
};

export type OAuthStateResult = {
  codeVerifier: string;
  returnTo: string;
};

export type OAuthExchangeInput = {
  provider: "discord";
  providerAccountId: string;
  email: string;
  displayName: string;
  sessionTokenHash: string;
  sessionExpiresAt: Date;
  now: Date;
  ipAddress: string | null;
  userAgent: string | null;
};

export type RotateSessionInput = {
  sessionId: string;
  actorUserId: string;
  sessionTokenHash: string;
  sessionExpiresAt: Date;
  now: Date;
  ipAddress: string | null;
  userAgent: string | null;
};

export type RotateSessionResult = {
  sessionId: string;
  sessionFamilyId: string;
  expiresAt: Date;
};

export class DraftImportConflictError extends Error {
  readonly status = 409;
  readonly code = "DRAFT_IMPORT_CONFLICT";

  constructor() {
    super("Aynı aktarım anahtarı farklı bir taslak için kullanılmış.");
    this.name = "DraftImportConflictError";
  }
}

const HEX_256 = /^[a-f0-9]{64}$/;

function assertSha256(value: string) {
  if (!HEX_256.test(value)) throw new TypeError("Geçersiz SHA-256 özeti.");
}

function milliseconds(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  const result = date.getTime();
  if (!Number.isFinite(result)) throw new TypeError("Veritabanı geçersiz zaman değeri döndürdü.");
  return result;
}

function requiredText(value: unknown, field: string) {
  if (typeof value !== "string" || !value) throw new TypeError(`Veritabanı ${field} alanını döndürmedi.`);
  return value;
}

export class PostgresAuthRepository {
  private readonly database: TransactionalSqlExecutor;

  constructor(database: TransactionalSqlExecutor) {
    this.database = database;
  }

  async takeRateLimit(input: {
    scope: string;
    bucketHash: string;
    policy: RateLimitPolicy;
    now: Date;
  }): Promise<RateLimitDecision> {
    assertSha256(input.bucketHash);

    return this.database.transaction(async (transaction) => {
      await transaction.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${input.scope}:${input.bucketHash}`],
      );

      const current = await transaction.query<{
        attempts: unknown;
        window_started_at: unknown;
        blocked_until: unknown;
      }>(
        `SELECT attempts, window_started_at, blocked_until
           FROM auth_rate_limits
          WHERE scope = $1 AND bucket_key = decode($2, 'hex')
          FOR UPDATE`,
        [input.scope, input.bucketHash],
      );

      const row = current.rows[0];
      const state: RateLimitState | null = row ? {
        attempts: Number(row.attempts),
        windowStartedAtMs: milliseconds(row.window_started_at),
        blockedUntilMs: row.blocked_until == null ? null : milliseconds(row.blocked_until),
      } : null;
      const decision = evaluateFixedWindowRateLimit(state, input.policy, input.now.getTime());

      await transaction.query(
        `INSERT INTO auth_rate_limits
           (scope, bucket_key, attempts, window_started_at, blocked_until, updated_at)
         VALUES ($1, decode($2, 'hex'), $3, $4, $5, $6)
         ON CONFLICT (scope, bucket_key) DO UPDATE SET
           attempts = EXCLUDED.attempts,
           window_started_at = EXCLUDED.window_started_at,
           blocked_until = EXCLUDED.blocked_until,
           updated_at = EXCLUDED.updated_at`,
        [
          input.scope,
          input.bucketHash,
          decision.nextState.attempts,
          new Date(decision.nextState.windowStartedAtMs),
          decision.nextState.blockedUntilMs == null ? null : new Date(decision.nextState.blockedUntilMs),
          input.now,
        ],
      );

      return decision;
    });
  }

  async createMagicLinkChallenge(input: CreateMagicLinkChallengeInput) {
    assertSha256(input.tokenHash);
    const result = await this.database.query<{ id: unknown }>(
      `INSERT INTO verification_tokens
         (purpose, destination_email, token_hash, expires_at, requested_ip,
          return_to, requested_display_name, consent_version, delivery_status)
       VALUES ($1, $2, decode($3, 'hex'), $4, $5, $6, $7, $8, 'pending')
       RETURNING id::text AS id`,
      [
        input.purpose,
        input.email,
        input.tokenHash,
        input.expiresAt,
        input.requestedIp,
        input.returnTo,
        input.displayName,
        input.consentVersion,
      ],
    );
    return requiredText(result.rows[0]?.id, "verification_tokens.id");
  }

  async markMagicLinkDelivered(challengeId: string, now: Date) {
    const result = await this.database.query<{ id: unknown }>(
      `UPDATE verification_tokens
          SET delivery_status = 'sent', delivered_at = $2
        WHERE id = $1::uuid
          AND delivery_status = 'pending'
          AND consumed_at IS NULL
          AND revoked_at IS NULL
        RETURNING id::text AS id`,
      [challengeId, now],
    );
    return result.rows.length === 1;
  }

  async markMagicLinkDeliveryFailed(challengeId: string, now: Date) {
    const result = await this.database.query<{ id: unknown }>(
      `UPDATE verification_tokens
          SET delivery_status = 'failed', delivery_failed_at = $2, revoked_at = COALESCE(revoked_at, $2)
        WHERE id = $1::uuid AND consumed_at IS NULL
        RETURNING id::text AS id`,
      [challengeId, now],
    );
    return result.rows.length === 1;
  }

  async exchangeMagicLink(input: MagicLinkExchangeInput): Promise<MagicLinkExchangeResult | null> {
    assertSha256(input.challengeTokenHash);
    assertSha256(input.sessionTokenHash);

    return this.database.transaction(async (transaction) => {
      const challengeResult = await transaction.query<{
        destination_email: unknown;
        purpose: unknown;
        requested_display_name: unknown;
        consent_version: unknown;
        return_to: unknown;
      }>(
        `UPDATE verification_tokens
            SET consumed_at = $2
          WHERE token_hash = decode($1, 'hex')
            AND purpose IN ('signin', 'verify_email')
            AND delivery_status = 'sent'
            AND consumed_at IS NULL
            AND revoked_at IS NULL
            AND expires_at > $2
          RETURNING destination_email, purpose, requested_display_name, consent_version, return_to`,
        [input.challengeTokenHash, input.now],
      );
      const challenge = challengeResult.rows[0];
      if (!challenge) return null;

      const email = requiredText(challenge.destination_email, "verification_tokens.destination_email");
      const purpose = requiredText(challenge.purpose, "verification_tokens.purpose");
      await transaction.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`identity:${email}`],
      );

      let userResult = await transaction.query<{
        id: unknown;
        email: unknown;
        display_name: unknown;
      }>(
        `SELECT id::text AS id, email, display_name
           FROM users
          WHERE email = $1 AND deleted_at IS NULL AND status = 'active'
          FOR UPDATE`,
        [email],
      );

      if (userResult.rows.length === 0 && purpose === "verify_email") {
        if (typeof challenge.requested_display_name !== "string") return null;
        userResult = await transaction.query<{
          id: unknown;
          email: unknown;
          display_name: unknown;
        }>(
          `INSERT INTO users (email, display_name, email_verified_at)
           VALUES ($1, $2, $3)
           RETURNING id::text AS id, email, display_name`,
          [email, challenge.requested_display_name, input.now],
        );
      }

      const user = userResult.rows[0];
      if (!user) return null;
      const userId = requiredText(user.id, "users.id");

      await transaction.query(
        `UPDATE users
            SET email_verified_at = COALESCE(email_verified_at, $2), updated_at = $2
          WHERE id = $1::uuid`,
        [userId, input.now],
      );
      await transaction.query(
        `INSERT INTO auth_accounts (user_id, provider, provider_account_id, provider_email)
         VALUES ($1::uuid, 'email', $2, $2)
         ON CONFLICT (provider, provider_account_id) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           provider_email = EXCLUDED.provider_email,
           updated_at = $3`,
        [userId, email, input.now],
      );

      if (typeof challenge.consent_version === "string") {
        await transaction.query(
          `INSERT INTO consents
             (user_id, consent_key, document_version, granted, source, ip_address)
           VALUES ($1::uuid, 'kvkk_communication', $2, true, 'registration', $3)
           ON CONFLICT (user_id, consent_key, document_version) DO NOTHING`,
          [userId, challenge.consent_version, input.ipAddress],
        );
      }

      const sessionResult = await transaction.query<{
        id: unknown;
        family_id: unknown;
      }>(
        `INSERT INTO auth_sessions
           (user_id, token_hash, expires_at, ip_address, user_agent)
         VALUES ($1::uuid, decode($2, 'hex'), $3, $4, $5)
         RETURNING id::text AS id, family_id::text AS family_id`,
        [
          userId,
          input.sessionTokenHash,
          input.sessionExpiresAt,
          input.ipAddress,
          input.userAgent,
        ],
      );
      const session = sessionResult.rows[0];
      const sessionId = requiredText(session?.id, "auth_sessions.id");
      const sessionFamilyId = requiredText(session?.family_id, "auth_sessions.family_id");

      await transaction.query(
        `INSERT INTO audit_logs
           (actor_user_id, action, target_type, target_id, ip_address, user_agent, metadata)
         VALUES ($1::uuid, 'auth.magic_link.consumed', 'auth_session', $2, $3, $4,
                 jsonb_build_object('purpose', $5::text))`,
        [userId, sessionId, input.ipAddress, input.userAgent, purpose],
      );

      return {
        userId,
        sessionId,
        sessionFamilyId,
        email: requiredText(user.email, "users.email"),
        displayName: requiredText(user.display_name, "users.display_name"),
        returnTo: requiredText(challenge.return_to, "verification_tokens.return_to"),
      };
    });
  }

  async createOAuthState(input: CreateOAuthStateInput) {
    assertSha256(input.stateHash);
    const result = await this.database.query<{ id: unknown }>(
      `INSERT INTO oauth_states
         (provider, state_hash, code_verifier, return_to, expires_at, requested_ip)
       VALUES ($1, decode($2, 'hex'), $3, $4, $5, $6)
       RETURNING id::text AS id`,
      [
        input.provider,
        input.stateHash,
        input.codeVerifier,
        input.returnTo,
        input.expiresAt,
        input.requestedIp,
      ],
    );
    return requiredText(result.rows[0]?.id, "oauth_states.id");
  }

  /** Single-use: the same state can never be redeemed twice, even concurrently. */
  async consumeOAuthState(input: {
    provider: "discord";
    stateHash: string;
    now: Date;
  }): Promise<OAuthStateResult | null> {
    assertSha256(input.stateHash);
    const result = await this.database.query<{ code_verifier: unknown; return_to: unknown }>(
      `UPDATE oauth_states
          SET consumed_at = $3
        WHERE provider = $1
          AND state_hash = decode($2, 'hex')
          AND consumed_at IS NULL
          AND expires_at > $3
        RETURNING code_verifier, return_to`,
      [input.provider, input.stateHash, input.now],
    );
    const row = result.rows[0];
    if (!row) return null;

    return {
      codeVerifier: requiredText(row.code_verifier, "oauth_states.code_verifier"),
      returnTo: requiredText(row.return_to, "oauth_states.return_to"),
    };
  }

  /**
   * Links a provider account to an identity and opens a session in one transaction.
   *
   * The provider account is the primary key of the link. A verified provider
   * email may adopt an existing local identity, but an account already linked to
   * another user is never re-pointed.
   */
  async exchangeOAuthAccount(input: OAuthExchangeInput): Promise<MagicLinkExchangeResult | null> {
    assertSha256(input.sessionTokenHash);

    return this.database.transaction(async (transaction) => {
      await transaction.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`identity:${input.email}`],
      );

      const linked = await transaction.query<{ user_id: unknown }>(
        `SELECT user_id::text AS user_id
           FROM auth_accounts
          WHERE provider = $1 AND provider_account_id = $2`,
        [input.provider, input.providerAccountId],
      );

      let userId = typeof linked.rows[0]?.user_id === "string" ? linked.rows[0].user_id : null;
      if (!userId) {
        const existing = await transaction.query<{ id: unknown }>(
          `SELECT id::text AS id
             FROM users
            WHERE email = $1 AND deleted_at IS NULL AND status = 'active'
            FOR UPDATE`,
          [input.email],
        );
        userId = typeof existing.rows[0]?.id === "string" ? existing.rows[0].id : null;
      }

      if (!userId) {
        const created = await transaction.query<{ id: unknown }>(
          `INSERT INTO users (email, display_name, email_verified_at)
           VALUES ($1, $2, $3)
           RETURNING id::text AS id`,
          [input.email, input.displayName, input.now],
        );
        userId = requiredText(created.rows[0]?.id, "users.id");
      }

      // The stored link is the authority on ownership. On conflict the existing
      // user_id is kept and returned, so a racing request can never open a
      // session for a user the provider account does not belong to.
      const link = await transaction.query<{ user_id: unknown }>(
        `INSERT INTO auth_accounts (user_id, provider, provider_account_id, provider_email)
         VALUES ($1::uuid, $2, $3, $4)
         ON CONFLICT (provider, provider_account_id) DO UPDATE SET
           provider_email = EXCLUDED.provider_email,
           updated_at = $5
         RETURNING user_id::text AS user_id`,
        [userId, input.provider, input.providerAccountId, input.email, input.now],
      );
      userId = requiredText(link.rows[0]?.user_id, "auth_accounts.user_id");

      const user = await transaction.query<{ id: unknown; email: unknown; display_name: unknown }>(
        `UPDATE users
            SET email_verified_at = COALESCE(email_verified_at, $2), updated_at = $2
          WHERE id = $1::uuid AND deleted_at IS NULL AND status = 'active'
          RETURNING id::text AS id, email, display_name`,
        [userId, input.now],
      );
      if (user.rows.length !== 1) return null;

      const sessionResult = await transaction.query<{ id: unknown; family_id: unknown }>(
        `INSERT INTO auth_sessions
           (user_id, token_hash, expires_at, ip_address, user_agent)
         VALUES ($1::uuid, decode($2, 'hex'), $3, $4, $5)
         RETURNING id::text AS id, family_id::text AS family_id`,
        [userId, input.sessionTokenHash, input.sessionExpiresAt, input.ipAddress, input.userAgent],
      );
      const sessionId = requiredText(sessionResult.rows[0]?.id, "auth_sessions.id");
      const sessionFamilyId = requiredText(sessionResult.rows[0]?.family_id, "auth_sessions.family_id");

      await transaction.query(
        `INSERT INTO audit_logs
           (actor_user_id, action, target_type, target_id, ip_address, user_agent, metadata, occurred_at)
         VALUES ($1::uuid, 'auth.oauth.consumed', 'auth_session', $2, $3, $4,
                 jsonb_build_object('provider', $5::text), $6)`,
        [userId, sessionId, input.ipAddress, input.userAgent, input.provider, input.now],
      );

      return {
        userId,
        sessionId,
        sessionFamilyId,
        email: requiredText(user.rows[0].email, "users.email"),
        displayName: requiredText(user.rows[0].display_name, "users.display_name"),
        returnTo: "/panel",
      };
    });
  }

  /**
   * Deletes identity records that can no longer be used.
   *
   * These tables only ever grow: every sign-in attempt writes a challenge, every
   * Discord redirect a state, every request a rate-limit bucket. Expired rows
   * carry no value but do carry a destination address, so removing them is both
   * housekeeping and data minimisation.
   *
   * Rate-limit buckets are kept until their block has elapsed; deleting one
   * early would hand a blocked caller a fresh allowance.
   */
  async purgeExpiredAuthRecords(now: Date, retention: { verificationTokenGraceMs: number }) {
    const consumedBefore = new Date(now.getTime() - retention.verificationTokenGraceMs);

    return this.database.transaction(async (transaction) => {
      const tokens = await transaction.query<{ id: unknown }>(
        `DELETE FROM verification_tokens
          WHERE expires_at < $1
             OR (consumed_at IS NOT NULL AND consumed_at < $2)
          RETURNING id`,
        [now, consumedBefore],
      );
      const states = await transaction.query<{ id: unknown }>(
        `DELETE FROM oauth_states
          WHERE expires_at < $1 OR consumed_at IS NOT NULL
          RETURNING id`,
        [now],
      );
      const buckets = await transaction.query<{ scope: unknown }>(
        `DELETE FROM auth_rate_limits
          WHERE updated_at < $1 AND (blocked_until IS NULL OR blocked_until < $2)
          RETURNING scope`,
        [consumedBefore, now],
      );
      const sessions = await transaction.query<{ id: unknown }>(
        `DELETE FROM auth_sessions
          WHERE expires_at < $1 OR (revoked_at IS NOT NULL AND revoked_at < $2)
          RETURNING id`,
        [now, consumedBefore],
      );

      return {
        verificationTokens: tokens.rows.length,
        oauthStates: states.rows.length,
        rateLimitBuckets: buckets.rows.length,
        sessions: sessions.rows.length,
      };
    });
  }

  async findActiveSession(tokenHash: string, now: Date): Promise<ActiveSessionResult | null> {
    assertSha256(tokenHash);
    const result = await this.database.query<{
      session_id: unknown;
      family_id: unknown;
      user_id: unknown;
      email: unknown;
      display_name: unknown;
      expires_at: unknown;
    }>(
      `SELECT s.id::text AS session_id, s.family_id::text AS family_id,
              u.id::text AS user_id, u.email, u.display_name, s.expires_at
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = decode($1, 'hex')
          AND s.revoked_at IS NULL
          AND s.expires_at > $2
          AND u.status = 'active'
          AND u.deleted_at IS NULL`,
      [tokenHash, now],
    );
    const row = result.rows[0];
    if (!row) return null;

    return {
      sessionId: requiredText(row.session_id, "auth_sessions.id"),
      sessionFamilyId: requiredText(row.family_id, "auth_sessions.family_id"),
      userId: requiredText(row.user_id, "users.id"),
      email: requiredText(row.email, "users.email"),
      displayName: requiredText(row.display_name, "users.display_name"),
      expiresAt: new Date(milliseconds(row.expires_at)),
    };
  }

  /**
   * Reacts to a token that was already replaced.
   *
   * A rotated session token is revoked the moment its successor is issued, so a
   * later presentation means the value was captured. The honest reading is that
   * the whole chain is compromised: every live session in that family is
   * revoked and the event is recorded for the operator.
   */
  async revokeSessionFamilyOnReuse(tokenHash: string, now: Date) {
    assertSha256(tokenHash);

    return this.database.transaction(async (transaction) => {
      const replayed = await transaction.query<{ family_id: unknown; user_id: unknown }>(
        `SELECT family_id::text AS family_id, user_id::text AS user_id
           FROM auth_sessions
          WHERE token_hash = decode($1, 'hex') AND revoked_at IS NOT NULL`,
        [tokenHash],
      );
      const session = replayed.rows[0];
      if (!session) return null;

      const familyId = requiredText(session.family_id, "auth_sessions.family_id");
      const userId = requiredText(session.user_id, "users.id");
      const revoked = await transaction.query<{ id: unknown }>(
        `UPDATE auth_sessions
            SET revoked_at = $2
          WHERE family_id = $1::uuid AND revoked_at IS NULL
          RETURNING id::text AS id`,
        [familyId, now],
      );

      await transaction.query(
        `INSERT INTO audit_logs
           (actor_user_id, action, target_type, target_id, metadata, occurred_at)
         VALUES ($1::uuid, 'auth.session.reuse_detected', 'auth_session_family', $2,
                 jsonb_build_object('revoked', $3::int), $4)`,
        [userId, familyId, revoked.rows.length, now],
      );

      return { familyId, userId, revokedSessions: revoked.rows.length };
    });
  }

  async touchSession(sessionId: string, actorUserId: string, now: Date) {
    const result = await this.database.query<{ id: unknown }>(
      `UPDATE auth_sessions
          SET last_seen_at = $3
        WHERE id = $1::uuid AND user_id = $2::uuid
          AND revoked_at IS NULL AND expires_at > $3
        RETURNING id::text AS id`,
      [sessionId, actorUserId, now],
    );
    return result.rows.length === 1;
  }

  async revokeSession(sessionId: string, actorUserId: string, now: Date) {
    return this.database.transaction(async (transaction) => {
      const result = await transaction.query<{ id: unknown }>(
        `UPDATE auth_sessions
            SET revoked_at = COALESCE(revoked_at, $3)
          WHERE id = $1::uuid AND user_id = $2::uuid
          RETURNING id::text AS id`,
        [sessionId, actorUserId, now],
      );
      if (result.rows.length !== 1) return false;

      await transaction.query(
        `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, occurred_at)
         VALUES ($1::uuid, 'auth.session.revoked', 'auth_session', $2, $3)`,
        [actorUserId, sessionId, now],
      );
      return true;
    });
  }

  /**
   * Replaces a live session token inside one transaction. The successor keeps the
   * original family so a stolen-token replay stays traceable to its origin.
   */
  async rotateSession(input: RotateSessionInput): Promise<RotateSessionResult | null> {
    assertSha256(input.sessionTokenHash);

    return this.database.transaction(async (transaction) => {
      const revoked = await transaction.query<{ family_id: unknown }>(
        `UPDATE auth_sessions
            SET revoked_at = $3
          WHERE id = $1::uuid AND user_id = $2::uuid
            AND revoked_at IS NULL AND expires_at > $3
          RETURNING family_id::text AS family_id`,
        [input.sessionId, input.actorUserId, input.now],
      );
      const previous = revoked.rows[0];
      if (!previous) return null;

      const familyId = requiredText(previous.family_id, "auth_sessions.family_id");
      const created = await transaction.query<{ id: unknown }>(
        `INSERT INTO auth_sessions
           (user_id, token_hash, expires_at, ip_address, user_agent, family_id, rotated_from_session_id)
         VALUES ($1::uuid, decode($2, 'hex'), $3, $4, $5, $6::uuid, $7::uuid)
         RETURNING id::text AS id`,
        [
          input.actorUserId,
          input.sessionTokenHash,
          input.sessionExpiresAt,
          input.ipAddress,
          input.userAgent,
          familyId,
          input.sessionId,
        ],
      );
      const sessionId = requiredText(created.rows[0]?.id, "auth_sessions.id");

      await transaction.query(
        `INSERT INTO audit_logs
           (actor_user_id, action, target_type, target_id, ip_address, user_agent, metadata, occurred_at)
         VALUES ($1::uuid, 'auth.session.rotated', 'auth_session', $2, $3, $4,
                 jsonb_build_object('rotated_from_session_id', $5::text), $6)`,
        [input.actorUserId, sessionId, input.ipAddress, input.userAgent, input.sessionId, input.now],
      );

      return { sessionId, sessionFamilyId: familyId, expiresAt: input.sessionExpiresAt };
    });
  }

  async revokeAllUserSessions(actorUserId: string, now: Date) {
    return this.database.transaction(async (transaction) => {
      const result = await transaction.query<{ id: unknown }>(
        `UPDATE auth_sessions
            SET revoked_at = COALESCE(revoked_at, $2)
          WHERE user_id = $1::uuid AND revoked_at IS NULL
          RETURNING id::text AS id`,
        [actorUserId, now],
      );
      await transaction.query(
        `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata)
         VALUES ($1::uuid, 'auth.sessions.revoked_all', 'user', $1, jsonb_build_object('count', $2::int))`,
        [actorUserId, result.rows.length],
      );
      return result.rows.length;
    });
  }

  async importDeviceDraft(command: DeviceDraftImportCommand, catalogVersion: string) {
    assertSha256(command.payloadHash);

    return this.database.transaction(async (transaction) => {
      await transaction.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`draft-import:${command.ownerUserId}:${command.importKey}`],
      );
      const receipt = await transaction.query<{
        server_draft_id: unknown;
        payload_hash: unknown;
      }>(
        `SELECT server_draft_id::text AS server_draft_id, encode(payload_hash, 'hex') AS payload_hash
           FROM draft_import_receipts
          WHERE owner_user_id = $1::uuid AND import_key = $2::uuid`,
        [command.ownerUserId, command.importKey],
      );
      const previous = receipt.rows[0];
      if (previous) {
        if (previous.payload_hash !== command.payloadHash) throw new DraftImportConflictError();
        return {
          serverDraftId: requiredText(previous.server_draft_id, "draft_import_receipts.server_draft_id"),
          replay: true,
        };
      }

      const draftResult = await transaction.query<{ id: unknown }>(
        `INSERT INTO server_drafts
           (owner_user_id, catalog_version, specification, device_import_key)
         VALUES ($1::uuid, $2, $3::jsonb, $4::uuid)
         RETURNING id::text AS id`,
        [command.ownerUserId, catalogVersion, JSON.stringify(command.draft), command.importKey],
      );
      const serverDraftId = requiredText(draftResult.rows[0]?.id, "server_drafts.id");
      await transaction.query(
        `INSERT INTO draft_import_receipts
           (owner_user_id, import_key, payload_hash, server_draft_id)
         VALUES ($1::uuid, $2::uuid, decode($3, 'hex'), $4::uuid)`,
        [command.ownerUserId, command.importKey, command.payloadHash, serverDraftId],
      );

      return { serverDraftId, replay: false };
    });
  }
}
