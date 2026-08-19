import type { TransactionalSqlExecutor } from "./auth-repository.ts";
import type { AdminRole } from "./admin-repository.ts";

export type AdminPasswordIdentity = {
  userId: string;
  role: AdminRole;
  /** Null until the password is changed from the panel; the bootstrap environment hash covers that gap. */
  passwordHash: string | null;
};

const HEX_256 = /^[a-f0-9]{64}$/;

function readRole(value: unknown): AdminRole | null {
  return value === "owner" || value === "operator" || value === "support" ? value : null;
}

function readText(value: unknown, field: string) {
  if (typeof value !== "string" || !value) throw new TypeError(`Veritabanı ${field} alanını döndürmedi.`);
  return value;
}

/**
 * Where the admin password verifier lives once it can be changed.
 *
 * Reading the identity and opening the session are separate steps on purpose:
 * the password itself is verified in the service layer, so no plaintext ever
 * reaches SQL, a log line, or a bound parameter.
 */
export class PostgresAdminCredentialsRepository {
  private readonly database: TransactionalSqlExecutor;

  constructor(database: TransactionalSqlExecutor) {
    this.database = database;
  }

  async findPasswordIdentity(email: string): Promise<AdminPasswordIdentity | null> {
    const result = await this.database.query<Record<string, unknown>>(
      `SELECT u.id::text AS user_id, m.role, m.password_hash
         FROM users u
         JOIN admin_memberships m ON m.user_id = u.id
        WHERE u.email = $1 AND u.status = 'active' AND u.deleted_at IS NULL
          AND u.email_verified_at IS NOT NULL`,
      [email],
    );
    const row = result.rows[0];
    const role = readRole(row?.role);
    if (!row || !role) return null;
    return {
      userId: readText(row.user_id, "users.id"),
      role,
      passwordHash: typeof row.password_hash === "string" && row.password_hash ? row.password_hash : null,
    };
  }

  /** Opens an ordinary Riftory session, but only while the membership is still there. */
  async openPasswordSession(input: {
    userId: string;
    sessionTokenHash: string;
    sessionExpiresAt: Date;
    ipAddress: string | null;
    userAgent: string | null;
    now: Date;
  }): Promise<{ role: AdminRole } | null> {
    if (!HEX_256.test(input.sessionTokenHash)) throw new TypeError("Geçersiz oturum özeti.");

    return this.database.transaction(async (transaction) => {
      await transaction.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`admin-login:${input.userId}`],
      );
      const identity = await transaction.query<Record<string, unknown>>(
        `SELECT m.role
           FROM users u
           JOIN admin_memberships m ON m.user_id = u.id
          WHERE u.id = $1::uuid AND u.status = 'active' AND u.deleted_at IS NULL
            AND u.email_verified_at IS NOT NULL
          FOR UPDATE OF u`,
        [input.userId],
      );
      const role = readRole(identity.rows[0]?.role);
      if (!role) return null;

      const session = await transaction.query<Record<string, unknown>>(
        `INSERT INTO auth_sessions
           (user_id, token_hash, expires_at, ip_address, user_agent)
         VALUES ($1::uuid, decode($2, 'hex'), $3, $4, $5)
         RETURNING id::text AS id`,
        [input.userId, input.sessionTokenHash, input.sessionExpiresAt, input.ipAddress, input.userAgent],
      );
      const sessionId = readText(session.rows[0]?.id, "auth_sessions.id");
      await transaction.query(
        `INSERT INTO audit_logs
           (actor_user_id, action, target_type, target_id, ip_address, user_agent, metadata, occurred_at)
         VALUES ($1::uuid, 'auth.admin_password.consumed', 'auth_session', $2, $3, $4,
                 jsonb_build_object('role', $5::text), $6)`,
        [input.userId, sessionId, input.ipAddress, input.userAgent, role, input.now],
      );
      return { role };
    });
  }

  async findCredential(userId: string): Promise<{ role: AdminRole; passwordHash: string | null } | null> {
    const result = await this.database.query<Record<string, unknown>>(
      `SELECT m.role, m.password_hash
         FROM admin_memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.user_id = $1::uuid AND u.status = 'active' AND u.deleted_at IS NULL`,
      [userId],
    );
    const row = result.rows[0];
    const role = readRole(row?.role);
    if (!row || !role) return null;
    return {
      role,
      passwordHash: typeof row.password_hash === "string" && row.password_hash ? row.password_hash : null,
    };
  }

  /**
   * Stores a new verifier and ends every other session of the same admin.
   *
   * A password change is also the answer to "someone else may be signed in as
   * me", so the sessions that were not used to make the change do not survive it.
   */
  async changePassword(input: {
    userId: string;
    passwordHash: string;
    keepSessionTokenHash: string;
    now: Date;
  }): Promise<{ status: "changed"; revokedSessions: number } | { status: "not_admin" }> {
    if (!HEX_256.test(input.keepSessionTokenHash)) throw new TypeError("Geçersiz oturum özeti.");

    return this.database.transaction(async (transaction) => {
      await transaction.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`admin-password:${input.userId}`],
      );
      const updated = await transaction.query<Record<string, unknown>>(
        `UPDATE admin_memberships
            SET password_hash = $2, password_updated_at = $3, updated_at = $3
          WHERE user_id = $1::uuid
          RETURNING role`,
        [input.userId, input.passwordHash, input.now],
      );
      if (!readRole(updated.rows[0]?.role)) return { status: "not_admin" };

      const revoked = await transaction.query(
        `UPDATE auth_sessions
            SET revoked_at = $2
          WHERE user_id = $1::uuid AND revoked_at IS NULL
            AND token_hash <> decode($3, 'hex')`,
        [input.userId, input.now, input.keepSessionTokenHash],
      );
      await transaction.query(
        `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata, occurred_at)
         VALUES ($1::uuid, 'admin.password.changed', 'user', $1::text,
                 jsonb_build_object('revoked_sessions', $2::int), $3)`,
        [input.userId, revoked.rowCount ?? 0, input.now],
      );
      return { status: "changed", revokedSessions: revoked.rowCount ?? 0 };
    });
  }

  /**
   * Grants or re-roles an admin membership for an account that already exists.
   *
   * Creating the user is deliberately not part of this: an operator invited
   * through the console would be an account nobody verified, and the console
   * would then be able to mint its own access.
   */
  async grantMembership(input: {
    email: string;
    role: AdminRole;
    actorUserId: string;
    now: Date;
  }): Promise<{ status: "granted" | "updated"; userId: string } | { status: "user_not_found" }> {
    return this.database.transaction(async (transaction) => {
      const found = await transaction.query<Record<string, unknown>>(
        `SELECT id::text AS user_id
           FROM users
          WHERE email = $1 AND status = 'active' AND deleted_at IS NULL
            AND email_verified_at IS NOT NULL
          FOR UPDATE`,
        [input.email],
      );
      const userId = typeof found.rows[0]?.user_id === "string" ? found.rows[0].user_id : null;
      if (!userId) return { status: "user_not_found" };

      const existing = await transaction.query(
        `SELECT 1 FROM admin_memberships WHERE user_id = $1::uuid FOR UPDATE`,
        [userId],
      );
      const alreadyMember = existing.rows.length > 0;
      await transaction.query(
        `INSERT INTO admin_memberships (user_id, role, granted_by_user_id, created_at, updated_at)
         VALUES ($1::uuid, $2, $3::uuid, $4, $4)
         ON CONFLICT (user_id) DO UPDATE
           SET role = EXCLUDED.role, granted_by_user_id = EXCLUDED.granted_by_user_id, updated_at = EXCLUDED.updated_at`,
        [userId, input.role, input.actorUserId, input.now],
      );
      await transaction.query(
        `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata, occurred_at)
         VALUES ($1::uuid, $2, 'user', $3, jsonb_build_object('role', $4::text), $5)`,
        [
          input.actorUserId,
          alreadyMember ? "admin.membership.updated" : "admin.membership.granted",
          userId,
          input.role,
          input.now,
        ],
      );
      return { status: alreadyMember ? "updated" : "granted", userId };
    });
  }

  /**
   * Removes an admin membership, leaving the ordinary customer account intact.
   *
   * Two refusals keep the console from locking itself: an admin cannot remove
   * their own access by accident, and the last owner cannot be removed at all.
   */
  async revokeMembership(input: {
    userId: string;
    actorUserId: string;
    now: Date;
  }): Promise<{ status: "revoked" | "not_found" | "self" | "last_owner" }> {
    if (input.userId === input.actorUserId) return { status: "self" };

    return this.database.transaction(async (transaction) => {
      await transaction.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        ["admin-membership"],
      );
      const target = await transaction.query<Record<string, unknown>>(
        `SELECT role FROM admin_memberships WHERE user_id = $1::uuid FOR UPDATE`,
        [input.userId],
      );
      const role = readRole(target.rows[0]?.role);
      if (!role) return { status: "not_found" };

      if (role === "owner") {
        const owners = await transaction.query<Record<string, unknown>>(
          `SELECT count(*)::text AS total FROM admin_memberships WHERE role = 'owner'`,
        );
        if (Number(owners.rows[0]?.total ?? 0) <= 1) return { status: "last_owner" };
      }

      await transaction.query(`DELETE FROM admin_memberships WHERE user_id = $1::uuid`, [input.userId]);
      // Access has to stop now, not when the stolen session happens to expire.
      await transaction.query(
        `UPDATE auth_sessions SET revoked_at = $2 WHERE user_id = $1::uuid AND revoked_at IS NULL`,
        [input.userId, input.now],
      );
      await transaction.query(
        `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata, occurred_at)
         VALUES ($1::uuid, 'admin.membership.revoked', 'user', $2, jsonb_build_object('role', $3::text), $4)`,
        [input.actorUserId, input.userId, role, input.now],
      );
      return { status: "revoked" };
    });
  }
}
