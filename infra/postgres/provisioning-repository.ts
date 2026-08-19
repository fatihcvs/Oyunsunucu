import {
  JOB_LEASE_MS,
  JOB_MAX_ATTEMPTS,
  canServerTransition,
  jobIdempotencyKey,
  retryDelayMs,
  type JobKind,
  type ServerStatus,
} from "../../lib/provisioning-contracts.ts";
import type { SqlExecutor, TransactionalSqlExecutor } from "./auth-repository.ts";

export type ServerRecord = {
  serverId: string;
  ownerUserId: string;
  status: ServerStatus;
  gameId: string;
  softwareId: string;
  planId: string;
  regionId: string;
  name: string;
  /** Raw stored settings; callers normalise them against the game catalogue. */
  settings: Record<string, unknown>;
};

/** A server as the panel shows it: the record plus what the customer connects to. */
export type StoredSchedule = {
  kind: "restart";
  hour: number;
  minute: number;
  offsetMinutes: number;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
};

export type OwnedServer = ServerRecord & {
  connection: { host: string; port: number } | null;
  /** The daily restart, if the customer set one. */
  schedule: StoredSchedule | null;
  /** The command still in flight, if any; the panel disables its buttons on it. */
  pendingJobKind: JobKind | null;
  createdAt: string;
  updatedAt: string;
};

export type ServerEvent = {
  kind: string;
  message: string;
  occurredAt: string;
};

export type ClaimedJob = {
  jobId: string;
  serverId: string | null;
  orderId: string | null;
  kind: JobKind;
  attempts: number;
  payload: Record<string, unknown>;
};

export type ServerSetupInput = {
  /** Null for a server the operator grants directly, with no purchase behind it. */
  orderId: string | null;
  /** What the idempotency key is derived from; the order id when there is one. */
  reference?: string;
  ownerUserId: string;
  specification: {
    gameId: string;
    softwareId: string;
    planId: string;
    regionId: string;
    serverName: string;
  };
  now: Date;
};

export type ServerSetupResult = { server: ServerRecord; jobId: string; created: boolean };

function requiredText(value: unknown, field: string) {
  if (typeof value !== "string" || !value) throw new TypeError(`Veritabanı ${field} alanını döndürmedi.`);
  return value;
}

function toServerRecord(row: Record<string, unknown>): ServerRecord {
  return {
    serverId: requiredText(row.id, "servers.id"),
    ownerUserId: requiredText(row.owner_user_id, "servers.owner_user_id"),
    status: requiredText(row.status, "servers.status") as ServerStatus,
    gameId: requiredText(row.game_id, "servers.game_id"),
    softwareId: requiredText(row.software_id, "servers.software_id"),
    planId: requiredText(row.plan_id, "servers.plan_id"),
    regionId: requiredText(row.region_id, "servers.region_id"),
    name: requiredText(row.name, "servers.name"),
    // Older rows and the INSERT ... RETURNING paths may not carry the column.
    settings: typeof row.settings === "object" && row.settings !== null && !Array.isArray(row.settings)
      ? row.settings as Record<string, unknown>
      : {},
  };
}

export async function findServerSetupByReference(
  database: SqlExecutor,
  reference: string,
): Promise<ServerSetupResult | null> {
  const key = jobIdempotencyKey("create_server", reference);
  const existing = await database.query<Record<string, unknown>>(
    `SELECT j.id::text AS job_id, s.id::text AS id, s.owner_user_id::text AS owner_user_id,
            s.status, s.game_id, s.software_id, s.plan_id, s.region_id, s.name
       FROM provisioning_jobs j
       JOIN servers s ON s.id = j.server_id
      WHERE j.idempotency_key = $1`,
    [key],
  );
  if (!existing.rows[0]) return null;
  return {
    server: toServerRecord(existing.rows[0]),
    jobId: requiredText(existing.rows[0].job_id, "provisioning_jobs.id"),
    created: false,
  };
}

/** Shared transaction body for paid orders and explicitly audited manual beta grants. */
export async function enqueueServerSetupWithExecutor(
  database: SqlExecutor,
  input: ServerSetupInput,
): Promise<ServerSetupResult> {
  const reference = input.reference ?? input.orderId;
  if (!reference) throw new TypeError("Kurulum işi için bir referans gerekir.");
  const key = jobIdempotencyKey("create_server", reference);
  const existing = await findServerSetupByReference(database, reference);
  if (existing) return existing;

  const created = await database.query<Record<string, unknown>>(
    `INSERT INTO servers
       (owner_user_id, order_id, game_id, software_id, plan_id, region_id, name, status, created_at, updated_at)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, 'requested', $8, $8)
     RETURNING id::text AS id, owner_user_id::text AS owner_user_id, status,
               game_id, software_id, plan_id, region_id, name`,
    [
      input.ownerUserId,
      input.orderId,
      input.specification.gameId,
      input.specification.softwareId,
      input.specification.planId,
      input.specification.regionId,
      input.specification.serverName,
      input.now,
    ],
  );
  const server = toServerRecord(created.rows[0] ?? {});

  const job = await database.query<{ id: unknown }>(
    `INSERT INTO provisioning_jobs
       (server_id, order_id, kind, idempotency_key, payload, max_attempts, run_after, created_at, updated_at)
     VALUES ($1::uuid, $2::uuid, 'create_server', $3, $4::jsonb, $5, $6, $6, $6)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id::text AS id`,
    [
      server.serverId,
      input.orderId,
      key,
      JSON.stringify(input.specification),
      JOB_MAX_ATTEMPTS,
      input.now,
    ],
  );
  if (job.rows.length === 0) throw new TypeError("Kurulum işi yarış sonucu oluşturulamadı.");

  const jobId = requiredText(job.rows[0].id, "provisioning_jobs.id");
  await database.query(
    `INSERT INTO server_events (server_id, job_id, kind, customer_message, operator_detail, occurred_at)
     VALUES ($1::uuid, $2::uuid, 'setup_queued', $3, $4, $5)`,
    [
      server.serverId,
      jobId,
      "Sunucu kurulumu sıraya alındı.",
      `order=${input.orderId}`,
      input.now,
    ],
  );

  return { server, jobId, created: true };
}

export class PostgresProvisioningRepository {
  private readonly database: TransactionalSqlExecutor;

  constructor(database: TransactionalSqlExecutor) {
    this.database = database;
  }

  /**
   * Turns a paid order into exactly one server and one setup job.
   *
   * Both rows are written in the transaction that observes the paid order, so a
   * paid order can never exist without its job, and a redelivered payment
   * cannot produce a second server: the job's idempotency key is derived from
   * the order id, and the unique index refuses the duplicate.
   */
  async enqueueServerSetup(input: {
    /** Null for a server the operator grants directly, with no purchase behind it. */
    orderId: string | null;
    /** What the idempotency key is derived from; the order id when there is one. */
    reference?: string;
    ownerUserId: string;
    specification: {
      gameId: string;
      softwareId: string;
      planId: string;
      regionId: string;
      serverName: string;
    };
    now: Date;
  }): Promise<ServerSetupResult> {
    return this.database.transaction((transaction) => enqueueServerSetupWithExecutor(transaction, input));
  }

  /**
   * Queues a start, stop, restart or delete for a server the customer owns.
   *
   * Only one operation may be outstanding per server. A second click, or two
   * browser tabs, finds the first job still unfinished and joins it instead of
   * queueing a competing command — two conflicting operations arriving at the
   * provider is exactly how a server ends up in a state nobody asked for.
   */
  async enqueueLifecycleJob(input: {
    serverId: string;
    ownerUserId: string;
    kind: Exclude<JobKind, "create_server">;
    now: Date;
  }): Promise<{ jobId: string; created: boolean }> {
    return this.database.transaction(async (transaction) => {
      await transaction.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`server-operation:${input.serverId}`],
      );

      const owned = await transaction.query<{ id: unknown }>(
        `SELECT id::text AS id FROM servers WHERE id = $1::uuid AND owner_user_id = $2::uuid`,
        [input.serverId, input.ownerUserId],
      );
      // A stranger's server answers exactly like a missing one.
      if (owned.rows.length !== 1) throw new TypeError("Sunucu bulunamadı.");

      const pending = await transaction.query<{ id: unknown; kind: unknown }>(
        `SELECT id::text AS id, kind FROM provisioning_jobs
          WHERE server_id = $1::uuid AND status IN ('pending', 'leased')
          LIMIT 1`,
        [input.serverId],
      );
      if (pending.rows[0]) {
        return { jobId: requiredText(pending.rows[0].id, "provisioning_jobs.id"), created: false };
      }

      const key = `${jobIdempotencyKey(input.kind, input.serverId)}:${input.now.getTime()}`;
      const job = await transaction.query<{ id: unknown }>(
        `INSERT INTO provisioning_jobs
           (server_id, kind, idempotency_key, max_attempts, run_after, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $5, $5)
         RETURNING id::text AS id`,
        [input.serverId, input.kind, key, JOB_MAX_ATTEMPTS, input.now],
      );
      const jobId = requiredText(job.rows[0]?.id, "provisioning_jobs.id");

      await transaction.query(
        `INSERT INTO server_events (server_id, job_id, kind, customer_message, occurred_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5)`,
        [input.serverId, jobId, `${input.kind}_queued`, "İstek sıraya alındı.", input.now],
      );

      return { jobId, created: true };
    });
  }

  /**
   * Takes ownership of one due job.
   *
   * `FOR UPDATE SKIP LOCKED` lets several workers pull from the same queue
   * without ever handing the same job to two of them. The lease means a worker
   * that dies does not strand the job: it becomes claimable again once the
   * lease expires.
   */
  async claimJob(owner: string, now: Date): Promise<ClaimedJob | null> {
    return this.database.transaction(async (transaction) => {
      const candidate = await transaction.query<{ id: unknown }>(
        `SELECT id::text AS id
           FROM provisioning_jobs
          WHERE run_after <= $1
            AND (status = 'pending' OR (status = 'leased' AND leased_until < $1))
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1`,
        [now],
      );
      const jobId = candidate.rows[0]?.id;
      if (typeof jobId !== "string") return null;

      const leased = await transaction.query<Record<string, unknown>>(
        `UPDATE provisioning_jobs
            SET status = 'leased',
                attempts = attempts + 1,
                lease_owner = $2,
                leased_until = $3,
                updated_at = $4
          WHERE id = $1::uuid
          RETURNING id::text AS id, server_id::text AS server_id, order_id::text AS order_id,
                    kind, attempts, payload`,
        [jobId, owner, new Date(now.getTime() + JOB_LEASE_MS), now],
      );
      const row = leased.rows[0];
      if (!row) return null;

      const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
      return {
        jobId: requiredText(row.id, "provisioning_jobs.id"),
        serverId: typeof row.server_id === "string" ? row.server_id : null,
        orderId: typeof row.order_id === "string" ? row.order_id : null,
        kind: requiredText(row.kind, "provisioning_jobs.kind") as JobKind,
        attempts: Number(row.attempts),
        payload: (payload ?? {}) as Record<string, unknown>,
      };
    });
  }

  async completeJob(input: {
    jobId: string;
    serverId: string | null;
    serverStatus: ServerStatus | null;
    connection?: { host: string; port: number } | null;
    customerMessage: string;
    now: Date;
  }) {
    return this.database.transaction(async (transaction) => {
      await transaction.query(
        `UPDATE provisioning_jobs
            SET status = 'succeeded', leased_until = NULL, lease_owner = NULL, last_error = NULL, updated_at = $2
          WHERE id = $1::uuid`,
        [input.jobId, input.now],
      );

      if (input.serverId && input.serverStatus) {
        await transaction.query(
          `UPDATE servers
              SET status = $2,
                  connection_host = COALESCE($3, connection_host),
                  connection_port = COALESCE($4, connection_port),
                  updated_at = $5
            WHERE id = $1::uuid`,
          [
            input.serverId,
            input.serverStatus,
            input.connection?.host ?? null,
            input.connection?.port ?? null,
            input.now,
          ],
        );
        await transaction.query(
          `INSERT INTO server_events (server_id, job_id, kind, customer_message, occurred_at)
           VALUES ($1::uuid, $2::uuid, 'job_succeeded', $3, $4)`,
          [input.serverId, input.jobId, input.customerMessage, input.now],
        );
      }
    });
  }

  /**
   * Records a failure and decides whether it is worth another try.
   *
   * Past the attempt ceiling the job is `dead`: it stops consuming worker time
   * and becomes an operator's problem instead of retrying forever. The customer
   * message and the technical detail are stored separately so an error can be
   * explained without exposing internals.
   */
  async failJob(input: {
    jobId: string;
    serverId: string | null;
    attempts: number;
    operatorDetail: string;
    customerMessage: string;
    now: Date;
  }) {
    const exhausted = input.attempts >= JOB_MAX_ATTEMPTS;

    return this.database.transaction(async (transaction) => {
      await transaction.query(
        `UPDATE provisioning_jobs
            SET status = $2,
                run_after = $3,
                leased_until = NULL,
                lease_owner = NULL,
                last_error = $4,
                updated_at = $5
          WHERE id = $1::uuid`,
        [
          input.jobId,
          exhausted ? "dead" : "pending",
          new Date(input.now.getTime() + retryDelayMs(input.attempts)),
          input.operatorDetail.slice(0, 2_000),
          input.now,
        ],
      );

      if (input.serverId) {
        await transaction.query(
          `INSERT INTO server_events (server_id, job_id, kind, customer_message, operator_detail, occurred_at)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)`,
          [
            input.serverId,
            input.jobId,
            exhausted ? "job_dead" : "job_retrying",
            input.customerMessage,
            input.operatorDetail.slice(0, 2_000),
            input.now,
          ],
        );
        if (exhausted) {
          await transaction.query(
            "UPDATE servers SET status = 'failed', updated_at = $2 WHERE id = $1::uuid",
            [input.serverId, input.now],
          );
        }
      }

      return { retrying: !exhausted };
    });
  }

  async markServerStatus(serverId: string, from: ServerStatus, to: ServerStatus, now: Date) {
    if (!canServerTransition(from, to)) return null;

    const result = await this.database.query<{ status: unknown }>(
      `UPDATE servers SET status = $3, updated_at = $4
        WHERE id = $1::uuid AND status = $2
        RETURNING status`,
      [serverId, from, to, now],
    );
    return result.rows[0] ? (requiredText(result.rows[0].status, "servers.status") as ServerStatus) : null;
  }

  async recordProviderResource(input: {
    serverId: string;
    provider: string;
    resourceKind: "service" | "volume" | "proxy" | "container";
    providerResourceId: string;
    now: Date;
  }) {
    const result = await this.database.query<{ id: unknown }>(
      `INSERT INTO provider_resources (server_id, provider, resource_kind, provider_resource_id, created_at)
       VALUES ($1::uuid, $2, $3, $4, $5)
       ON CONFLICT (provider, resource_kind, provider_resource_id) DO NOTHING
       RETURNING id::text AS id`,
      [input.serverId, input.provider, input.resourceKind, input.providerResourceId, input.now],
    );
    return result.rows.length === 1;
  }

  /**
   * The servers one customer owns, newest first.
   *
   * Deleted servers are left out: the row is kept for accounting, but a
   * customer looking at their panel should not see a server they no longer
   * have. The outstanding job kind travels with each row so the panel can show
   * what is happening without a second round trip per server.
   */
  async listServersForOwner(ownerUserId: string): Promise<OwnedServer[]> {
    const result = await this.database.query<Record<string, unknown>>(
      `SELECT s.id::text AS id, s.owner_user_id::text AS owner_user_id, s.status,
              s.game_id, s.software_id, s.plan_id, s.region_id, s.name, s.settings,
              s.connection_host, s.connection_port, s.created_at, s.updated_at,
              (SELECT j.kind FROM provisioning_jobs j
                WHERE j.server_id = s.id AND j.status IN ('pending', 'leased')
                ORDER BY j.created_at LIMIT 1) AS pending_kind,
              c.local_hour, c.local_minute, c.offset_minutes,
              c.enabled AS schedule_enabled, c.next_run_at, c.last_run_at
         FROM servers s
         LEFT JOIN server_schedules c ON c.server_id = s.id AND c.kind = 'restart'
        WHERE s.owner_user_id = $1::uuid AND s.status <> 'deleted'
        ORDER BY s.created_at DESC
        LIMIT 100`,
      [ownerUserId],
    );

    return result.rows.map((row) => ({
      ...toServerRecord(row),
      connection:
        typeof row.connection_host === "string" && row.connection_port != null
          ? { host: row.connection_host, port: Number(row.connection_port) }
          : null,
      pendingJobKind: typeof row.pending_kind === "string" ? (row.pending_kind as JobKind) : null,
      schedule: row.next_run_at
        ? {
          kind: "restart" as const,
          hour: Number(row.local_hour),
          minute: Number(row.local_minute),
          offsetMinutes: Number(row.offset_minutes),
          enabled: row.schedule_enabled === true,
          nextRunAt: new Date(row.next_run_at as string).toISOString(),
          lastRunAt: row.last_run_at ? new Date(row.last_run_at as string).toISOString() : null,
        }
        : null,
      createdAt: new Date(row.created_at as string).toISOString(),
      updatedAt: new Date(row.updated_at as string).toISOString(),
    }));
  }

  /**
   * The recent history of one server, in the words shown to its owner.
   *
   * `operator_detail` is deliberately not selected: it holds provider messages
   * and internal ids, which belong in operator tooling rather than in a
   * customer's panel.
   */
  async listServerEvents(serverId: string, limit = 20): Promise<ServerEvent[]> {
    const result = await this.database.query<Record<string, unknown>>(
      `SELECT kind, customer_message, occurred_at
         FROM server_events
        WHERE server_id = $1::uuid AND customer_message IS NOT NULL
        ORDER BY occurred_at DESC, id DESC
        LIMIT $2`,
      [serverId, Math.min(Math.max(1, limit), 100)],
    );

    return result.rows.map((row) => ({
      kind: requiredText(row.kind, "server_events.kind"),
      message: requiredText(row.customer_message, "server_events.customer_message"),
      occurredAt: new Date(row.occurred_at as string).toISOString(),
    }));
  }

  /**
   * Stores new settings and queues the job that pushes them to the provider.
   *
   * Writing the row and queueing the job in one transaction means the panel
   * never shows a setting the provider was never told about, and a crash
   * between the two cannot leave them disagreeing.
   */
  async saveSettings(input: {
    serverId: string;
    ownerUserId: string;
    settings: Record<string, unknown>;
    allowedStatuses: readonly ServerStatus[];
    now: Date;
  }): Promise<
    | { status: "queued"; jobId: string }
    | { status: "not_found" | "not_allowed" | "conflict" }
  > {
    return this.database.transaction(async (transaction) => {
      await transaction.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`server-operation:${input.serverId}`],
      );

      const owned = await transaction.query<Record<string, unknown>>(
        `SELECT status FROM servers
          WHERE id = $1::uuid AND owner_user_id = $2::uuid
          FOR UPDATE`,
        [input.serverId, input.ownerUserId],
      );
      const current = owned.rows[0];
      // A stranger's server answers exactly like a missing one.
      if (!current) return { status: "not_found" };
      if (!input.allowedStatuses.includes(current.status as ServerStatus)) return { status: "not_allowed" };

      const pending = await transaction.query(
        `SELECT 1 FROM provisioning_jobs
          WHERE server_id = $1::uuid AND status IN ('pending', 'leased')
          LIMIT 1`,
        [input.serverId],
      );
      if (pending.rows.length > 0) return { status: "conflict" };

      await transaction.query(
        `UPDATE servers SET settings = $2::jsonb, settings_updated_at = $3, updated_at = $3
          WHERE id = $1::uuid`,
        [input.serverId, JSON.stringify(input.settings), input.now],
      );

      const key = `${jobIdempotencyKey("apply_settings", input.serverId)}:${input.now.getTime()}`;
      const job = await transaction.query<Record<string, unknown>>(
        `INSERT INTO provisioning_jobs
           (server_id, kind, idempotency_key, max_attempts, run_after, created_at, updated_at)
         VALUES ($1::uuid, 'apply_settings', $2, $3, $4, $4, $4)
         RETURNING id::text AS id`,
        [input.serverId, key, JOB_MAX_ATTEMPTS, input.now],
      );
      const jobId = requiredText(job.rows[0]?.id, "provisioning_jobs.id");

      await transaction.query(
        `INSERT INTO server_events (server_id, job_id, kind, customer_message, occurred_at)
         VALUES ($1::uuid, $2::uuid, 'apply_settings_queued', $3, $4)`,
        [
          input.serverId,
          jobId,
          "Ayarlar kaydedildi; sunucu yeni ayarlarla yeniden başlatılıyor.",
          input.now,
        ],
      );

      return { status: "queued", jobId };
    });
  }

  /** Writes the schedule the customer chose; the caller computed `nextRunAt`. */
  async saveSchedule(input: {
    serverId: string;
    ownerUserId: string;
    kind: string;
    hour: number;
    minute: number;
    offsetMinutes: number;
    enabled: boolean;
    nextRunAt: Date;
    now: Date;
  }): Promise<{ status: "saved" } | { status: "not_found" }> {
    return this.database.transaction(async (transaction) => {
      const owned = await transaction.query(
        `SELECT 1 FROM servers
          WHERE id = $1::uuid AND owner_user_id = $2::uuid AND status <> 'deleted'`,
        [input.serverId, input.ownerUserId],
      );
      // A stranger's server answers exactly like a missing one.
      if (owned.rows.length !== 1) return { status: "not_found" };

      await transaction.query(
        `INSERT INTO server_schedules
           (server_id, kind, local_hour, local_minute, offset_minutes, enabled, next_run_at, updated_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (server_id, kind) DO UPDATE SET
           local_hour = EXCLUDED.local_hour,
           local_minute = EXCLUDED.local_minute,
           offset_minutes = EXCLUDED.offset_minutes,
           enabled = EXCLUDED.enabled,
           next_run_at = EXCLUDED.next_run_at,
           updated_at = EXCLUDED.updated_at`,
        [
          input.serverId,
          input.kind,
          input.hour,
          input.minute,
          input.offsetMinutes,
          input.enabled,
          input.nextRunAt,
          input.now,
        ],
      );
      return { status: "saved" };
    });
  }

  /**
   * Fires one due schedule, if there is one.
   *
   * Takes a single schedule per call under `FOR UPDATE SKIP LOCKED`, exactly
   * like the job queue: several workers can run this loop without any of them
   * firing the same restart. `next_run_at` moves forward inside the same
   * transaction that queues the job, so a crash between the two is impossible.
   *
   * A server that already has work outstanding is skipped rather than queued
   * behind it — a scheduled restart is a convenience, not something worth
   * stacking up while a setup or a settings change is mid-flight.
   */
  async claimDueSchedule(input: {
    now: Date;
    nextRunAt: (schedule: { hour: number; minute: number; offsetMinutes: number }, after: Date) => Date;
  }): Promise<{ serverId: string; jobId: string } | null> {
    return this.database.transaction(async (transaction) => {
      const due = await transaction.query<Record<string, unknown>>(
        `SELECT s.server_id::text AS server_id, s.local_hour, s.local_minute, s.offset_minutes,
                v.status AS server_status
           FROM server_schedules s
           JOIN servers v ON v.id = s.server_id
          WHERE s.enabled AND s.next_run_at <= $1 AND s.kind = 'restart'
          ORDER BY s.next_run_at
          LIMIT 1
          FOR UPDATE OF s SKIP LOCKED`,
        [input.now],
      );
      const row = due.rows[0];
      if (!row) return null;

      const serverId = requiredText(row.server_id, "server_schedules.server_id");
      const advanced = input.nextRunAt(
        {
          hour: Number(row.local_hour),
          minute: Number(row.local_minute),
          offsetMinutes: Number(row.offset_minutes),
        },
        input.now,
      );

      // The clock moves on whether or not the restart is queued, so a server
      // that was busy or offline this time is simply considered tomorrow.
      await transaction.query(
        `UPDATE server_schedules SET next_run_at = $2, last_run_at = $3, updated_at = $3
          WHERE server_id = $1::uuid AND kind = 'restart'`,
        [serverId, advanced, input.now],
      );

      if (row.server_status !== "online") return null;

      const pending = await transaction.query(
        `SELECT 1 FROM provisioning_jobs
          WHERE server_id = $1::uuid AND status IN ('pending', 'leased')
          LIMIT 1`,
        [serverId],
      );
      if (pending.rows.length > 0) return null;

      const key = `${jobIdempotencyKey("restart_server", serverId)}:${input.now.getTime()}`;
      const job = await transaction.query<Record<string, unknown>>(
        `INSERT INTO provisioning_jobs
           (server_id, kind, idempotency_key, max_attempts, run_after, created_at, updated_at)
         VALUES ($1::uuid, 'restart_server', $2, $3, $4, $4, $4)
         RETURNING id::text AS id`,
        [serverId, key, JOB_MAX_ATTEMPTS, input.now],
      );
      const jobId = requiredText(job.rows[0]?.id, "provisioning_jobs.id");

      await transaction.query(
        `INSERT INTO server_events (server_id, job_id, kind, customer_message, occurred_at)
         VALUES ($1::uuid, $2::uuid, 'scheduled_restart_queued', $3, $4)`,
        [serverId, jobId, "Zamanlanmış yeniden başlatma sıraya alındı.", input.now],
      );

      return { serverId, jobId };
    });
  }

  async findServer(serverId: string): Promise<ServerRecord | null> {
    const result = await this.database.query<Record<string, unknown>>(
      `SELECT id::text AS id, owner_user_id::text AS owner_user_id, status,
              game_id, software_id, plan_id, region_id, name, settings
         FROM servers WHERE id = $1::uuid`,
      [serverId],
    );
    return result.rows[0] ? toServerRecord(result.rows[0]) : null;
  }
}

export type { SqlExecutor };
