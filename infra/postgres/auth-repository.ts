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
                 jsonb_build_object('purpose', $5))`,
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
    const result = await this.database.query<{ id: unknown }>(
      `UPDATE auth_sessions
          SET revoked_at = COALESCE(revoked_at, $3)
        WHERE id = $1::uuid AND user_id = $2::uuid
        RETURNING id::text AS id`,
      [sessionId, actorUserId, now],
    );
    return result.rows.length === 1;
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
