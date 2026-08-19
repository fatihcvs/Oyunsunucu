import type { ActiveSessionResult } from "../infra/postgres/auth-repository.ts";
import type {
  AdminDashboardData,
  AdminPlanChangeOutcome,
  AdminProvisionServerOutcome,
  AdminRole,
  AdminServerCommandOutcome,
  RetryJobOutcome,
} from "../infra/postgres/admin-repository.ts";
import { evaluatePlanChange, upgradeOptions } from "./plan-change.ts";
import { findGameRuntime } from "../infra/gameservers/runtime-catalog.ts";
import type { JobKind } from "./provisioning-contracts.ts";
import { isValidEmail, normalizeEmail } from "./auth-contracts.ts";
import {
  ACTIVE_GAMES,
  HOSTING_PLANS,
  HOSTING_REGIONS,
  isServerDraft,
  sellableSoftware,
} from "./catalog.ts";

export class AdminFlowError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "AdminFlowError";
    this.status = status;
    this.code = code;
  }
}

export interface AdminMembershipRepository {
  grantMembership(input: {
    email: string;
    role: AdminRole;
    actorUserId: string;
    now: Date;
  }): Promise<{ status: "granted" | "updated"; userId: string } | { status: "user_not_found" }>;
  revokeMembership(input: {
    userId: string;
    actorUserId: string;
    now: Date;
  }): Promise<{ status: "revoked" | "not_found" | "self" | "last_owner" }>;
}

export interface AdminRepository {
  findMembership(userId: string): Promise<{ role: AdminRole } | null>;
  loadDashboard(input: { query: string; limit?: number; now: Date }): Promise<AdminDashboardData>;
  retryJob(input: { jobId: string; actorUserId: string; now: Date }): Promise<RetryJobOutcome>;
  commandServer(input: {
    serverId: string;
    kind: Exclude<JobKind, "create_server">;
    allowedStatuses: readonly string[];
    actorUserId: string;
    now: Date;
  }): Promise<AdminServerCommandOutcome>;
  changePlan(input: {
    serverId: string;
    toPlanId: string;
    allowedStatuses: readonly string[];
    actorUserId: string;
    now: Date;
  }): Promise<AdminPlanChangeOutcome>;
  provisionServer(input: {
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
  }): Promise<AdminProvisionServerOutcome>;
}

export type AdminService = ReturnType<typeof createAdminService>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
export const CLOSED_BETA_SERVER_LIMIT = 10;

/**
 * What the console may do to a server, and from which state.
 *
 * Wider than the customer's matrix — an operator can revive a failed setup and
 * tear a server down — but still state-checked, so a queued job is never a
 * command the provider cannot carry out. Deletion is owner-only because there
 * is no backup system to restore from yet.
 */
export const ADMIN_SERVER_COMMANDS = {
  baslat: { kind: "start_server", allowedStatuses: ["suspended"], ownerOnly: false },
  durdur: { kind: "stop_server", allowedStatuses: ["online"], ownerOnly: false },
  "yeniden-baslat": { kind: "restart_server", allowedStatuses: ["online"], ownerOnly: false },
  sil: { kind: "delete_server", allowedStatuses: ["online", "failed", "suspended"], ownerOnly: true },
} as const satisfies Record<string, {
  kind: Exclude<JobKind, "create_server">;
  allowedStatuses: readonly string[];
  ownerOnly: boolean;
}>;

export type AdminServerCommand = keyof typeof ADMIN_SERVER_COMMANDS;

/** A resize is applied by restarting, so only a running or stopped server takes one. */
const PLAN_CHANGE_ALLOWED_STATUSES = ["online", "suspended"] as const;

export function isAdminServerCommand(value: unknown): value is AdminServerCommand {
  return typeof value === "string" && value in ADMIN_SERVER_COMMANDS;
}

export type AdminProvisionServerRequest = {
  requestId: unknown;
  customerEmail: unknown;
  serverName: unknown;
  gameId: unknown;
  softwareId: unknown;
  planId: unknown;
  regionId: unknown;
  confirmCost: unknown;
};

function provisioningCatalog() {
  return {
    games: ACTIVE_GAMES.map((game) => ({
      id: game.id,
      name: game.name,
      tag: game.tag,
      software: sellableSoftware(game).flatMap((software) => {
        const runtime = findGameRuntime(game.id, software.id);
        return runtime?.image ? [{
          id: software.id,
          name: software.name,
          recommended: Boolean(software.recommended),
          minimumMemoryMb: runtime.minimumMemoryMb,
          verification: runtime.verification,
        }] : [];
      }),
    })).filter((game) => game.software.length > 0),
    plans: HOSTING_PLANS.map((plan) => ({
      id: plan.id,
      label: plan.label,
      ramGb: plan.ram,
      storageGb: plan.storage,
      monthlyPrice: plan.price,
    })),
    regions: HOSTING_REGIONS.map((region) => ({
      id: region.id,
      name: region.name,
      location: region.location,
      surcharge: region.surcharge,
    })),
  };
}

export function createAdminService(dependencies: {
  auth: { authenticateSession(rawToken: string): Promise<ActiveSessionResult | null> };
  repository: AdminRepository;
  memberships: AdminMembershipRepository;
  now?: () => Date;
  onOperationalError?: (error: unknown) => void;
}) {
  const now = dependencies.now ?? (() => new Date());

  async function authorize(rawToken: string) {
    const session = await dependencies.auth.authenticateSession(rawToken);
    if (!session) throw new AdminFlowError(401, "SESSION_REQUIRED", "Bu işlem için giriş yapılmalıdır.");

    const membership = await dependencies.repository.findMembership(session.userId);
    if (!membership) throw new AdminFlowError(403, "ADMIN_REQUIRED", "Bu alan yalnızca yetkili operasyon ekibine açıktır.");
    return { session, role: membership.role };
  }

  async function runOperational<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof AdminFlowError) throw error;
      try { dependencies.onOperationalError?.(error); } catch { /* Observability must not alter the result. */ }
      throw new AdminFlowError(503, "ADMIN_UNAVAILABLE", "Operasyon verisi şu anda okunamıyor.");
    }
  }

  return {
    async dashboard(rawToken: string, rawQuery = "") {
      return runOperational(async () => {
        const { session, role } = await authorize(rawToken);
        const query = rawQuery.trim();
        if (query.length > 80 || CONTROL_CHARACTERS.test(query)) {
          throw new AdminFlowError(400, "INVALID_QUERY", "Arama ifadesi geçersiz.");
        }
        const data = await dependencies.repository.loadDashboard({ query, now: now() });
        return {
          viewer: { displayName: session.displayName, email: session.email, role },
          capabilities: {
            canRetryJobs: role === "owner" || role === "operator",
            canProvisionServers: role === "owner" || role === "operator",
            canCommandServers: role === "owner" || role === "operator",
            canDeleteServers: role === "owner",
            canChangePlans: role === "owner" || role === "operator",
            canManageMemberships: role === "owner",
          },
          catalog: provisioningCatalog(),
          upgrades: Object.fromEntries(data.servers.map((server) => [
            server.serverId,
            upgradeOptions({
              fromPlanId: server.planId,
              regionId: server.regionId,
              gameId: server.gameId,
              softwareId: server.softwareId,
            }),
          ])),
          capacity: {
            activeServers: data.metrics.servers.total,
            limit: CLOSED_BETA_SERVER_LIMIT,
          },
          ...data,
        };
      });
    },

    /** Queues start, stop, restart or delete for any server in the fleet. */
    async commandServer(rawToken: string, input: { serverId: unknown; command: unknown }) {
      return runOperational(async () => {
        const { session, role } = await authorize(rawToken);
        if (role === "support") {
          throw new AdminFlowError(403, "ADMIN_WRITE_REQUIRED", "Destek rolü sunucu komutu veremez.");
        }
        if (!isAdminServerCommand(input.command)) {
          throw new AdminFlowError(400, "UNKNOWN_SERVER_COMMAND", "Bilinmeyen sunucu komutu.");
        }
        const command = ADMIN_SERVER_COMMANDS[input.command];
        if (command.ownerOnly && role !== "owner") {
          throw new AdminFlowError(403, "ADMIN_OWNER_REQUIRED", "Bu işlem yalnızca sahip rolüne açıktır.");
        }
        const serverId = typeof input.serverId === "string" ? input.serverId : "";
        if (!UUID.test(serverId)) throw new AdminFlowError(400, "INVALID_SERVER_ID", "Sunucu kimliği geçersiz.");

        const outcome = await dependencies.repository.commandServer({
          serverId,
          kind: command.kind,
          allowedStatuses: command.allowedStatuses,
          actorUserId: session.userId,
          now: now(),
        });
        if (outcome.status === "not_found") throw new AdminFlowError(404, "SERVER_NOT_FOUND", "Sunucu bulunamadı.");
        if (outcome.status === "not_allowed") {
          throw new AdminFlowError(409, "COMMAND_NOT_ALLOWED", "Sunucunun bu durumu istenen komutu yürütemez.");
        }
        if (outcome.status !== "queued") {
          throw new AdminFlowError(409, "SERVER_JOB_IN_FLIGHT", "Bu sunucu için başka bir işlem zaten sürüyor.");
        }
        return { queued: true, jobId: outcome.jobId, command: input.command };
      });
    },

    /**
     * Moves a server onto a bigger plan.
     *
     * The catalogue decides whether the move is possible and what it costs; the
     * console records it and queues the resize. No payment is taken here — the
     * closed beta has no payment provider wired, and inventing a charge would
     * be a claim the system cannot back. The price difference is reported so an
     * operator sees exactly what the change is worth.
     */
    async changePlan(rawToken: string, input: { serverId: unknown; planId: unknown }) {
      return runOperational(async () => {
        const { session, role } = await authorize(rawToken);
        if (role === "support") {
          throw new AdminFlowError(403, "ADMIN_WRITE_REQUIRED", "Destek rolü paket değiştiremez.");
        }
        const serverId = typeof input.serverId === "string" ? input.serverId : "";
        const toPlanId = typeof input.planId === "string" ? input.planId : "";
        if (!UUID.test(serverId)) throw new AdminFlowError(400, "INVALID_SERVER_ID", "Sunucu kimliği geçersiz.");

        const data = await dependencies.repository.loadDashboard({ query: serverId, now: now() });
        const server = data.servers.find((candidate) => candidate.serverId === serverId);
        if (!server) throw new AdminFlowError(404, "SERVER_NOT_FOUND", "Sunucu bulunamadı.");

        const check = evaluatePlanChange({
          fromPlanId: server.planId,
          toPlanId,
          regionId: server.regionId,
          gameId: server.gameId,
          softwareId: server.softwareId,
        });
        if (!check.ok) throw new AdminFlowError(400, check.code, check.message);

        const outcome = await dependencies.repository.changePlan({
          serverId,
          toPlanId,
          allowedStatuses: PLAN_CHANGE_ALLOWED_STATUSES,
          actorUserId: session.userId,
          now: now(),
        });
        if (outcome.status === "not_found") throw new AdminFlowError(404, "SERVER_NOT_FOUND", "Sunucu bulunamadı.");
        if (outcome.status === "not_allowed") {
          throw new AdminFlowError(409, "PLAN_CHANGE_NOT_ALLOWED", "Sunucu bu durumdayken paket değiştirilemez.");
        }
        if (outcome.status === "plan_unchanged") {
          throw new AdminFlowError(400, "PLAN_UNCHANGED", "Sunucu zaten bu pakette.");
        }
        if (outcome.status !== "queued") {
          throw new AdminFlowError(409, "SERVER_JOB_IN_FLIGHT", "Bu sunucu için başka bir işlem zaten sürüyor.");
        }

        return {
          queued: true,
          jobId: outcome.jobId,
          fromPlanId: outcome.fromPlanId,
          toPlanId,
          monthlyDifference: check.change.monthlyDifference,
          monthlyAfter: check.change.monthlyAfter,
          message: `Paket ${check.change.to.label} olarak güncellendi; aylık fark ${check.change.monthlyDifference} TL. Tahsilat yapılmadı.`,
        };
      });
    },

    /** Gives an existing, verified account admin access; it never creates the account. */
    async grantMembership(rawToken: string, input: { email: unknown; role: unknown }) {
      return runOperational(async () => {
        const { session, role } = await authorize(rawToken);
        if (role !== "owner") {
          throw new AdminFlowError(403, "ADMIN_OWNER_REQUIRED", "Üyelik yönetimi yalnızca sahip rolüne açıktır.");
        }
        const email = typeof input.email === "string" ? normalizeEmail(input.email) : "";
        if (!isValidEmail(email)) throw new AdminFlowError(400, "INVALID_EMAIL", "E-posta adresi geçersiz.");
        const grantedRole = input.role;
        if (grantedRole !== "owner" && grantedRole !== "operator" && grantedRole !== "support") {
          throw new AdminFlowError(400, "INVALID_ROLE", "Rol geçersiz.");
        }

        const outcome = await dependencies.memberships.grantMembership({
          email,
          role: grantedRole,
          actorUserId: session.userId,
          now: now(),
        });
        if (outcome.status === "user_not_found") {
          throw new AdminFlowError(404, "USER_NOT_FOUND", "Doğrulanmış aktif bir hesap bulunamadı.");
        }
        return {
          granted: outcome.status === "granted",
          userId: outcome.userId,
          message: outcome.status === "granted" ? "Yönetici yetkisi verildi." : "Yönetici rolü güncellendi.",
        };
      });
    },

    async revokeMembership(rawToken: string, input: { userId: unknown }) {
      return runOperational(async () => {
        const { session, role } = await authorize(rawToken);
        if (role !== "owner") {
          throw new AdminFlowError(403, "ADMIN_OWNER_REQUIRED", "Üyelik yönetimi yalnızca sahip rolüne açıktır.");
        }
        const userId = typeof input.userId === "string" ? input.userId : "";
        if (!UUID.test(userId)) throw new AdminFlowError(400, "INVALID_USER_ID", "Kullanıcı kimliği geçersiz.");

        const outcome = await dependencies.memberships.revokeMembership({
          userId,
          actorUserId: session.userId,
          now: now(),
        });
        if (outcome.status === "self") {
          throw new AdminFlowError(409, "CANNOT_REVOKE_SELF", "Kendi yönetici yetkinizi kaldıramazsınız.");
        }
        if (outcome.status === "last_owner") {
          throw new AdminFlowError(409, "LAST_OWNER", "Son sahip yetkisi kaldırılamaz.");
        }
        if (outcome.status === "not_found") {
          throw new AdminFlowError(404, "MEMBERSHIP_NOT_FOUND", "Yönetici üyeliği bulunamadı.");
        }
        return { revoked: true, message: "Yönetici yetkisi kaldırıldı; müşteri hesabı korundu." };
      });
    },

    async retryJob(rawToken: string, jobId: string) {
      return runOperational(async () => {
        const { session, role } = await authorize(rawToken);
        if (role === "support") {
          throw new AdminFlowError(403, "ADMIN_WRITE_REQUIRED", "Destek rolü operasyon işlerini değiştiremez.");
        }
        if (!UUID.test(jobId)) throw new AdminFlowError(400, "INVALID_JOB_ID", "İş kimliği geçersiz.");

        const outcome = await dependencies.repository.retryJob({ jobId, actorUserId: session.userId, now: now() });
        if (outcome.status === "not_found") throw new AdminFlowError(404, "JOB_NOT_FOUND", "İş bulunamadı.");
        if (outcome.status === "not_retryable") {
          throw new AdminFlowError(409, "JOB_NOT_RETRYABLE", "Yalnızca durmuş veya başarısız işler yeniden denenebilir.");
        }
        if (outcome.status === "conflict") {
          throw new AdminFlowError(409, "SERVER_JOB_IN_FLIGHT", "Bu sunucu için başka bir işlem zaten sürüyor.");
        }
        return outcome;
      });
    },

    async provisionServer(rawToken: string, input: AdminProvisionServerRequest) {
      return runOperational(async () => {
        const { session, role } = await authorize(rawToken);
        if (role === "support") {
          throw new AdminFlowError(403, "ADMIN_WRITE_REQUIRED", "Destek rolü sunucu tahsis edemez.");
        }
        if (input.confirmCost !== true) {
          throw new AdminFlowError(400, "COST_CONFIRMATION_REQUIRED", "Kaynak maliyeti onaylanmalıdır.");
        }

        const requestId = typeof input.requestId === "string" ? input.requestId.trim() : "";
        const customerEmail = typeof input.customerEmail === "string" ? normalizeEmail(input.customerEmail) : "";
        const serverName = typeof input.serverName === "string" ? input.serverName.trim() : "";
        const gameId = typeof input.gameId === "string" ? input.gameId : "";
        const softwareId = typeof input.softwareId === "string" ? input.softwareId : "";
        const planId = typeof input.planId === "string" ? input.planId : "";
        const regionId = typeof input.regionId === "string" ? input.regionId : "";
        if (!UUID.test(requestId)) {
          throw new AdminFlowError(400, "INVALID_REQUEST_ID", "Kurulum istek kimliği geçersiz.");
        }
        if (!isValidEmail(customerEmail)) {
          throw new AdminFlowError(400, "INVALID_CUSTOMER_EMAIL", "Müşteri e-postası geçersiz.");
        }
        if (serverName.length < 3 || serverName.length > 60 || CONTROL_CHARACTERS.test(serverName)) {
          throw new AdminFlowError(400, "INVALID_SERVER_NAME", "Sunucu adı 3-60 karakter olmalıdır.");
        }

        const draft = { gameId, softwareId, planId, regionId, serverName, backups: false };
        if (!isServerDraft(draft)) {
          throw new AdminFlowError(400, "INVALID_SERVER_SPECIFICATION", "Bu sunucu birleşimi katalogda açık değil.");
        }
        const runtime = findGameRuntime(gameId, softwareId);
        const plan = HOSTING_PLANS.find((candidate) => candidate.id === planId);
        if (!runtime?.image || !plan || plan.ram * 1_024 < runtime.minimumMemoryMb) {
          throw new AdminFlowError(400, "PLAN_TOO_SMALL", "Seçilen paket bu çalışma ortamı için yetersiz.");
        }

        const outcome = await dependencies.repository.provisionServer({
          requestId: requestId.toLowerCase(),
          customerEmail,
          actorUserId: session.userId,
          specification: { gameId, softwareId, planId, regionId, serverName },
          activeServerLimit: CLOSED_BETA_SERVER_LIMIT,
          now: now(),
        });
        if (outcome.status === "customer_not_found") {
          throw new AdminFlowError(404, "CUSTOMER_NOT_FOUND", "Doğrulanmış aktif müşteri hesabı bulunamadı.");
        }
        if (outcome.status === "limit_reached") {
          throw new AdminFlowError(409, "BETA_CAPACITY_REACHED", "Kapalı beta aktif sunucu sınırına ulaştı.");
        }
        if (outcome.status === "idempotency_conflict") {
          throw new AdminFlowError(409, "IDEMPOTENCY_CONFLICT", "Bu istek kimliği farklı bir kurulumda kullanılmış.");
        }
        if (outcome.status !== "queued" && outcome.status !== "existing") {
          throw new AdminFlowError(503, "ADMIN_UNAVAILABLE", "Sunucu kurulumu şu anda başlatılamadı.");
        }
        return {
          created: outcome.status === "queued",
          serverId: outcome.serverId,
          jobId: outcome.jobId,
          message: outcome.status === "queued"
            ? "Sunucu kurulumu kuyruğa alındı."
            : "Bu kurulum isteği daha önce kuyruğa alınmış.",
        };
      });
    },
  };
}
