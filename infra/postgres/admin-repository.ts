import { JOB_MAX_ATTEMPTS, jobIdempotencyKey, type JobKind } from "../../lib/provisioning-contracts.ts";
import type { TransactionalSqlExecutor } from "./auth-repository.ts";
import {
  enqueueServerSetupWithExecutor,
  findServerSetupByReference,
} from "./provisioning-repository.ts";

export type AdminRole = "owner" | "operator" | "support";

export type AdminMetrics = {
  users: { total: number; active: number; createdLast24Hours: number };
  orders: { total: number; pendingPayment: number; paidOrActive: number; failed: number };
  servers: { total: number; online: number; provisioning: number; failed: number };
  jobs: { queued: number; leased: number; dead: number };
};

export type AdminOrderRow = {
  orderId: string;
  customerEmail: string;
  customerName: string;
  status: string;
  totalMinor: number;
  currency: string;
  createdAt: string;
};

export type AdminServerRow = {
  serverId: string;
  customerEmail: string;
  name: string;
  gameId: string;
  softwareId: string;
  planId: string;
  regionId: string;
  source: "manual" | "order";
  status: string;
  pendingJobKind: string | null;
  connection: { host: string; port: number } | null;
  updatedAt: string;
  createdAt: string;
};

export type AdminJobRow = {
  jobId: string;
  serverId: string | null;
  serverName: string | null;
  customerEmail: string | null;
  kind: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  runAfter: string;
  updatedAt: string;
};

export type AdminCustomerRow = {
  userId: string;
  email: string;
  displayName: string;
  status: string;
  emailVerified: boolean;
  isAdmin: boolean;
  serverCount: number;
  createdAt: string;
};

export type AdminAuditRow = {
  auditId: string;
  action: string;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  occurredAt: string;
};

export type AdminMembershipRow = {
  userId: string;
  email: string;
  displayName: string;
  role: AdminRole;
  hasOwnPassword: boolean;
  createdAt: string;
};

export type AdminDashboardData = {
  metrics: AdminMetrics;
  orders: AdminOrderRow[];
  servers: AdminServerRow[];
  jobs: AdminJobRow[];
  customers: AdminCustomerRow[];
  auditLogs: AdminAuditRow[];
  memberships: AdminMembershipRow[];
  generatedAt: string;
};

export type RetryJobOutcome =
  | { status: "queued"; jobId: string; serverId: string | null }
  | { status: "not_found" | "not_retryable" | "conflict" };

export type AdminServerCommandOutcome =
  | { status: "queued"; jobId: string; created: boolean }
  | { status: "not_found" | "not_allowed" | "conflict" };

export type AdminProvisionServerOutcome =
  | { status: "queued" | "existing"; serverId: string; jobId: string }
  | { status: "customer_not_found" | "limit_reached" | "idempotency_conflict" };

function requiredText(value: unknown, field: string) {
  if (typeof value !== "string" || !value) throw new TypeError(`Veritabanı ${field} alanını döndürmedi.`);
  return value;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function adminRole(value: unknown): AdminRole {
  if (value !== "owner" && value !== "operator" && value !== "support") {
    throw new TypeError("Veritabanı geçersiz yönetici rolü döndürdü.");
  }
  return value;
}

function count(value: unknown) {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError("Veritabanı geçersiz sayaç döndürdü.");
  return parsed;
}

function instant(value: unknown, field: string) {
  const date = new Date(value as string | number | Date);
  if (Number.isNaN(date.getTime())) throw new TypeError(`Veritabanı ${field} alanını geçersiz döndürdü.`);
  return date.toISOString();
}

function money(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError("Veritabanı geçersiz para tutarı döndürdü.");
  return parsed;
}

/** PostgreSQL-backed operational read model and tightly scoped admin commands. */
export class PostgresAdminRepository {
  private readonly database: TransactionalSqlExecutor;

  constructor(database: TransactionalSqlExecutor) {
    this.database = database;
  }

  async findMembership(userId: string): Promise<{ role: AdminRole } | null> {
    const result = await this.database.query<Record<string, unknown>>(
      `SELECT m.role
         FROM admin_memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.user_id = $1::uuid AND u.status = 'active' AND u.deleted_at IS NULL`,
      [userId],
    );
    const role = result.rows[0]?.role;
    return role === "owner" || role === "operator" || role === "support" ? { role } : null;
  }

  async loadDashboard(input: { query: string; limit?: number; now: Date }): Promise<AdminDashboardData> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
    const query = input.query.trim();
    const pattern = `%${query}%`;

    const [
      users,
      ordersMetric,
      serversMetric,
      jobsMetric,
      orders,
      servers,
      jobs,
      customers,
      auditLogs,
      memberships,
    ] = await Promise.all([
      this.database.query<Record<string, unknown>>(
        `SELECT count(*)::text AS total,
                count(*) FILTER (WHERE status = 'active' AND deleted_at IS NULL)::text AS active,
                count(*) FILTER (WHERE created_at >= $1)::text AS created_last_24_hours
           FROM users`,
        [new Date(input.now.getTime() - 24 * 60 * 60 * 1_000)],
      ),
      this.database.query<Record<string, unknown>>(
        `SELECT count(*)::text AS total,
                count(*) FILTER (WHERE status = 'pending_payment')::text AS pending_payment,
                count(*) FILTER (WHERE status IN ('paid', 'provisioning', 'active'))::text AS paid_or_active,
                count(*) FILTER (WHERE status = 'failed')::text AS failed
           FROM orders`,
      ),
      this.database.query<Record<string, unknown>>(
        `SELECT count(*) FILTER (WHERE status <> 'deleted')::text AS total,
                count(*) FILTER (WHERE status = 'online')::text AS online,
                count(*) FILTER (WHERE status IN ('requested', 'provisioning', 'deploying'))::text AS provisioning,
                count(*) FILTER (WHERE status = 'failed')::text AS failed
           FROM servers`,
      ),
      this.database.query<Record<string, unknown>>(
        `SELECT count(*) FILTER (WHERE status = 'pending')::text AS queued,
                count(*) FILTER (WHERE status = 'leased')::text AS leased,
                count(*) FILTER (WHERE status IN ('dead', 'failed'))::text AS dead
           FROM provisioning_jobs`,
      ),
      this.database.query<Record<string, unknown>>(
        `SELECT o.id::text AS order_id, u.email, u.display_name, o.status,
                o.total_minor, o.currency, o.created_at
           FROM orders o
           JOIN users u ON u.id = o.owner_user_id
          WHERE ($1 = '' OR o.id::text ILIKE $2 OR u.email ILIKE $2 OR u.display_name ILIKE $2)
          ORDER BY o.created_at DESC
          LIMIT $3`,
        [query, pattern, limit],
      ),
      this.database.query<Record<string, unknown>>(
        `SELECT s.id::text AS server_id, u.email, s.name, s.game_id, s.software_id,
                s.plan_id, s.region_id, s.status, s.connection_host, s.connection_port,
                s.created_at, s.updated_at,
                CASE WHEN s.order_id IS NULL THEN 'manual' ELSE 'order' END AS source,
                (SELECT j.kind FROM provisioning_jobs j
                  WHERE j.server_id = s.id AND j.status IN ('pending', 'leased')
                  ORDER BY j.created_at LIMIT 1) AS pending_kind
           FROM servers s
           JOIN users u ON u.id = s.owner_user_id
          WHERE s.status <> 'deleted'
            AND ($1 = '' OR s.id::text ILIKE $2 OR s.name ILIKE $2 OR u.email ILIKE $2)
          ORDER BY s.updated_at DESC
          LIMIT $3`,
        [query, pattern, limit],
      ),
      this.database.query<Record<string, unknown>>(
        `SELECT j.id::text AS job_id, j.server_id::text AS server_id, s.name AS server_name,
                u.email, j.kind, j.status, j.attempts, j.max_attempts, j.last_error,
                j.run_after, j.updated_at
           FROM provisioning_jobs j
           LEFT JOIN servers s ON s.id = j.server_id
           LEFT JOIN users u ON u.id = s.owner_user_id
          WHERE ($1 = '' OR j.id::text ILIKE $2 OR s.name ILIKE $2 OR u.email ILIKE $2)
          ORDER BY
            CASE j.status WHEN 'dead' THEN 0 WHEN 'failed' THEN 0 WHEN 'leased' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
            j.updated_at DESC
          LIMIT $3`,
        [query, pattern, limit],
      ),
      this.database.query<Record<string, unknown>>(
        `SELECT u.id::text AS user_id, u.email, u.display_name, u.status,
                u.email_verified_at, u.created_at,
                (m.user_id IS NOT NULL) AS is_admin,
                (SELECT count(*) FROM servers s
                  WHERE s.owner_user_id = u.id AND s.status <> 'deleted')::text AS server_count
           FROM users u
           LEFT JOIN admin_memberships m ON m.user_id = u.id
          WHERE u.deleted_at IS NULL
            AND ($1 = '' OR u.id::text ILIKE $2 OR u.email ILIKE $2 OR u.display_name ILIKE $2)
          ORDER BY u.created_at DESC
          LIMIT $3`,
        [query, pattern, limit],
      ),
      // The audit trail is read-only here: the console shows what happened, it never rewrites it.
      this.database.query<Record<string, unknown>>(
        `SELECT a.id::text AS audit_id, a.action, u.email, a.target_type, a.target_id, a.occurred_at
           FROM audit_logs a
           LEFT JOIN users u ON u.id = a.actor_user_id
          WHERE ($1 = '' OR a.action ILIKE $2 OR u.email ILIKE $2 OR a.target_id ILIKE $2)
          ORDER BY a.occurred_at DESC
          LIMIT $3`,
        [query, pattern, limit],
      ),
      this.database.query<Record<string, unknown>>(
        `SELECT m.user_id::text AS user_id, u.email, u.display_name, m.role,
                (m.password_hash IS NOT NULL) AS has_own_password, m.created_at
           FROM admin_memberships m
           JOIN users u ON u.id = m.user_id
          WHERE u.deleted_at IS NULL
          ORDER BY m.created_at`,
      ),
    ]);

    const userMetric = users.rows[0] ?? {};
    const orderMetric = ordersMetric.rows[0] ?? {};
    const serverMetric = serversMetric.rows[0] ?? {};
    const jobMetric = jobsMetric.rows[0] ?? {};

    return {
      metrics: {
        users: {
          total: count(userMetric.total),
          active: count(userMetric.active),
          createdLast24Hours: count(userMetric.created_last_24_hours),
        },
        orders: {
          total: count(orderMetric.total),
          pendingPayment: count(orderMetric.pending_payment),
          paidOrActive: count(orderMetric.paid_or_active),
          failed: count(orderMetric.failed),
        },
        servers: {
          total: count(serverMetric.total),
          online: count(serverMetric.online),
          provisioning: count(serverMetric.provisioning),
          failed: count(serverMetric.failed),
        },
        jobs: {
          queued: count(jobMetric.queued),
          leased: count(jobMetric.leased),
          dead: count(jobMetric.dead),
        },
      },
      orders: orders.rows.map((row) => ({
        orderId: requiredText(row.order_id, "orders.id"),
        customerEmail: requiredText(row.email, "users.email"),
        customerName: requiredText(row.display_name, "users.display_name"),
        status: requiredText(row.status, "orders.status"),
        totalMinor: money(row.total_minor),
        currency: requiredText(row.currency, "orders.currency"),
        createdAt: instant(row.created_at, "orders.created_at"),
      })),
      servers: servers.rows.map((row) => ({
        serverId: requiredText(row.server_id, "servers.id"),
        customerEmail: requiredText(row.email, "users.email"),
        name: requiredText(row.name, "servers.name"),
        gameId: requiredText(row.game_id, "servers.game_id"),
        softwareId: requiredText(row.software_id, "servers.software_id"),
        planId: requiredText(row.plan_id, "servers.plan_id"),
        regionId: requiredText(row.region_id, "servers.region_id"),
        source: row.source === "order" ? "order" : "manual",
        status: requiredText(row.status, "servers.status"),
        pendingJobKind: optionalText(row.pending_kind),
        connection: typeof row.connection_host === "string" && row.connection_port != null
          ? { host: row.connection_host, port: Number(row.connection_port) }
          : null,
        updatedAt: instant(row.updated_at, "servers.updated_at"),
        createdAt: instant(row.created_at, "servers.created_at"),
      })),
      jobs: jobs.rows.map((row) => ({
        jobId: requiredText(row.job_id, "provisioning_jobs.id"),
        serverId: optionalText(row.server_id),
        serverName: optionalText(row.server_name),
        customerEmail: optionalText(row.email),
        kind: requiredText(row.kind, "provisioning_jobs.kind"),
        status: requiredText(row.status, "provisioning_jobs.status"),
        attempts: count(row.attempts),
        maxAttempts: count(row.max_attempts),
        lastError: optionalText(row.last_error),
        runAfter: instant(row.run_after, "provisioning_jobs.run_after"),
        updatedAt: instant(row.updated_at, "provisioning_jobs.updated_at"),
      })),
      customers: customers.rows.map((row) => ({
        userId: requiredText(row.user_id, "users.id"),
        email: requiredText(row.email, "users.email"),
        displayName: requiredText(row.display_name, "users.display_name"),
        status: requiredText(row.status, "users.status"),
        emailVerified: row.email_verified_at != null,
        isAdmin: row.is_admin === true,
        serverCount: count(row.server_count),
        createdAt: instant(row.created_at, "users.created_at"),
      })),
      auditLogs: auditLogs.rows.map((row) => ({
        auditId: requiredText(row.audit_id, "audit_logs.id"),
        action: requiredText(row.action, "audit_logs.action"),
        actorEmail: optionalText(row.email),
        targetType: optionalText(row.target_type),
        targetId: optionalText(row.target_id),
        occurredAt: instant(row.occurred_at, "audit_logs.occurred_at"),
      })),
      memberships: memberships.rows.map((row) => ({
        userId: requiredText(row.user_id, "admin_memberships.user_id"),
        email: requiredText(row.email, "users.email"),
        displayName: requiredText(row.display_name, "users.display_name"),
        role: adminRole(row.role),
        hasOwnPassword: row.has_own_password === true,
        createdAt: instant(row.created_at, "admin_memberships.created_at"),
      })),
      generatedAt: input.now.toISOString(),
    };
  }

  async provisionServer(input: {
    requestId: string;
    customerEmail: string;
    actorUserId: string;
    specification: {
      gameId: string;
      softwareId: string;
      planId: string;
      regionId: string;
      serverName: string;
    };
    activeServerLimit: number;
    now: Date;
  }): Promise<AdminProvisionServerOutcome> {
    if (!Number.isSafeInteger(input.activeServerLimit) || input.activeServerLimit < 1 || input.activeServerLimit > 100) {
      throw new TypeError("Aktif sunucu sınırı geçersiz.");
    }

    return this.database.transaction(async (transaction) => {
      await transaction.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        ["admin-manual-server-capacity"],
      );
      const customer = await transaction.query<Record<string, unknown>>(
        `SELECT id::text AS user_id
           FROM users
          WHERE email = $1 AND status = 'active' AND deleted_at IS NULL
            AND email_verified_at IS NOT NULL
          FOR UPDATE`,
        [input.customerEmail],
      );
      const ownerUserId = typeof customer.rows[0]?.user_id === "string" ? customer.rows[0].user_id : null;
      if (!ownerUserId) return { status: "customer_not_found" };

      const reference = `admin-manual:${input.requestId}`;
      const existing = await findServerSetupByReference(transaction, reference);
      if (existing) {
        const sameRequest = existing.server.ownerUserId === ownerUserId &&
          existing.server.gameId === input.specification.gameId &&
          existing.server.softwareId === input.specification.softwareId &&
          existing.server.planId === input.specification.planId &&
          existing.server.regionId === input.specification.regionId &&
          existing.server.name === input.specification.serverName;
        return sameRequest
          ? { status: "existing", serverId: existing.server.serverId, jobId: existing.jobId }
          : { status: "idempotency_conflict" };
      }

      const capacity = await transaction.query<Record<string, unknown>>(
        `SELECT count(*)::text AS active_servers
           FROM servers
          WHERE status <> 'deleted'`,
      );
      if (count(capacity.rows[0]?.active_servers) >= input.activeServerLimit) {
        return { status: "limit_reached" };
      }

      const queued = await enqueueServerSetupWithExecutor(transaction, {
        orderId: null,
        reference,
        ownerUserId,
        specification: input.specification,
        now: input.now,
      });
      await transaction.query(
        `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata, occurred_at)
         VALUES ($1::uuid, 'admin.server.provisioned', 'server', $2,
                 jsonb_build_object('owner_user_id', $3::text, 'job_id', $4::text,
                                    'game_id', $5::text, 'software_id', $6::text,
                                    'plan_id', $7::text, 'region_id', $8::text), $9)`,
        [
          input.actorUserId,
          queued.server.serverId,
          ownerUserId,
          queued.jobId,
          input.specification.gameId,
          input.specification.softwareId,
          input.specification.planId,
          input.specification.regionId,
          input.now,
        ],
      );
      await transaction.query(
        `INSERT INTO server_events (server_id, job_id, kind, operator_detail, occurred_at)
         VALUES ($1::uuid, $2::uuid, 'admin_manual_provisioned', $3, $4)`,
        [queued.server.serverId, queued.jobId, `actor=${input.actorUserId}`, input.now],
      );
      return { status: "queued", serverId: queued.server.serverId, jobId: queued.jobId };
    });
  }

  /**
   * Queues a lifecycle command for any server, without owning it.
   *
   * The operator reach is wider than the customer's — deleting and reviving a
   * failed setup are operator work — but the same single-operation rule holds:
   * one outstanding job per server, taken under an advisory lock, so two
   * operators clicking at once cannot send the provider conflicting orders.
   */
  async commandServer(input: {
    serverId: string;
    kind: Exclude<JobKind, "create_server">;
    allowedStatuses: readonly string[];
    actorUserId: string;
    now: Date;
  }): Promise<AdminServerCommandOutcome> {
    return this.database.transaction(async (transaction) => {
      await transaction.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`server-operation:${input.serverId}`],
      );

      const found = await transaction.query<Record<string, unknown>>(
        `SELECT id::text AS id, status FROM servers WHERE id = $1::uuid FOR UPDATE`,
        [input.serverId],
      );
      const server = found.rows[0];
      if (!server) return { status: "not_found" };
      if (!input.allowedStatuses.includes(String(server.status))) return { status: "not_allowed" };

      const pending = await transaction.query<Record<string, unknown>>(
        `SELECT id::text AS id FROM provisioning_jobs
          WHERE server_id = $1::uuid AND status IN ('pending', 'leased')
          LIMIT 1`,
        [input.serverId],
      );
      if (pending.rows[0]) return { status: "conflict" };

      const key = `${jobIdempotencyKey(input.kind, input.serverId)}:${input.now.getTime()}`;
      const job = await transaction.query<Record<string, unknown>>(
        `INSERT INTO provisioning_jobs
           (server_id, kind, idempotency_key, max_attempts, run_after, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $5, $5)
         RETURNING id::text AS id`,
        [input.serverId, input.kind, key, JOB_MAX_ATTEMPTS, input.now],
      );
      const jobId = requiredText(job.rows[0]?.id, "provisioning_jobs.id");

      await transaction.query(
        `INSERT INTO server_events
           (server_id, job_id, kind, customer_message, operator_detail, occurred_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)`,
        [
          input.serverId,
          jobId,
          `${input.kind}_queued`,
          "Operasyon ekibi bu işlemi sıraya aldı.",
          `actor=${input.actorUserId}`,
          input.now,
        ],
      );
      await transaction.query(
        `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata, occurred_at)
         VALUES ($1::uuid, 'admin.server.command', 'server', $2,
                 jsonb_build_object('kind', $3::text, 'job_id', $4::text,
                                    'previous_status', $5::text), $6)`,
        [input.actorUserId, input.serverId, input.kind, jobId, String(server.status), input.now],
      );

      return { status: "queued", jobId, created: true };
    });
  }

  async retryJob(input: { jobId: string; actorUserId: string; now: Date }): Promise<RetryJobOutcome> {
    return this.database.transaction(async (transaction) => {
      await transaction.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`admin-job:${input.jobId}`]);

      const selected = await transaction.query<Record<string, unknown>>(
        `SELECT id::text AS id, server_id::text AS server_id, kind, status
           FROM provisioning_jobs
          WHERE id = $1::uuid
          FOR UPDATE`,
        [input.jobId],
      );
      const job = selected.rows[0];
      if (!job) return { status: "not_found" };
      if (job.status !== "dead" && job.status !== "failed") return { status: "not_retryable" };

      const serverId = optionalText(job.server_id);
      if (serverId) {
        const active = await transaction.query(
          `SELECT 1 FROM provisioning_jobs
            WHERE server_id = $1::uuid AND id <> $2::uuid AND status IN ('pending', 'leased')
            LIMIT 1`,
          [serverId, input.jobId],
        );
        if (active.rows.length > 0) return { status: "conflict" };
      }

      await transaction.query(
        `UPDATE provisioning_jobs
            SET status = 'pending', attempts = 0, max_attempts = $2, run_after = $3,
                leased_until = NULL, lease_owner = NULL, last_error = NULL, updated_at = $3
          WHERE id = $1::uuid`,
        [input.jobId, JOB_MAX_ATTEMPTS, input.now],
      );

      if (serverId) {
        if (job.kind === "create_server") {
          await transaction.query(
            `UPDATE servers SET status = 'requested', updated_at = $2
              WHERE id = $1::uuid AND status = 'failed'`,
            [serverId, input.now],
          );
        }
        await transaction.query(
          `INSERT INTO server_events
             (server_id, job_id, kind, customer_message, operator_detail, occurred_at)
           VALUES ($1::uuid, $2::uuid, 'admin_job_retried',
                   'Operasyon ekibi işlemi yeniden sıraya aldı.', $3, $4)`,
          [serverId, input.jobId, `Admin ${input.actorUserId} işi yeniden kuyruğa aldı.`, input.now],
        );
      }

      await transaction.query(
        `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata, occurred_at)
         VALUES ($1::uuid, 'admin.provisioning.retry', 'provisioning_job', $2, $3::jsonb, $4)`,
        [input.actorUserId, input.jobId, JSON.stringify({ previousStatus: job.status, serverId }), input.now],
      );

      return { status: "queued", jobId: input.jobId, serverId };
    });
  }
}
