import { AuthFlowError, type AuthService } from "./auth-service.ts";
import {
  SERVER_COMMANDS,
  canCommandServer,
  type ServerCommand,
} from "./provisioning-contracts.ts";
import type {
  OwnedServer,
  PostgresProvisioningRepository,
  ServerEvent,
} from "../infra/postgres/provisioning-repository.ts";
import { getPlan } from "./catalog.ts";
import {
  normalizeStoredSettings,
  settingFields,
  supportsSettings,
  validateSettings,
  type ServerSettings,
  type SettingField,
} from "./server-settings.ts";
import { describeSchedule, nextRunAt, validateSchedule } from "./schedule-contracts.ts";

export type ServerServiceDependencies = {
  auth: AuthService;
  servers: PostgresProvisioningRepository;
  now?: () => Date;
  onOperationalError?: (error: unknown) => void;
};

/** One server as the panel renders it, plus which buttons it may show. */
export type PanelServer = {
  serverId: string;
  name: string;
  status: OwnedServer["status"];
  gameId: string;
  softwareId: string;
  planId: string;
  regionId: string;
  connection: { host: string; port: number } | null;
  /** The command in flight, if any; while it runs no other command is offered. */
  busyWith: string | null;
  availableCommands: ServerCommand[];
  /** The editable fields for this game, already narrowed to what the plan allows. */
  settingFields: readonly SettingField[];
  settings: ServerSettings;
  /** False while a job is in flight or the state cannot take a restart. */
  canEditSettings: boolean;
  schedule: OwnedServer["schedule"];
  scheduleDescription: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Settings are pushed by restarting, so only a running or stopped server takes them. */
const SETTINGS_ALLOWED_STATUSES = ["online", "suspended"] as const;

export class ServerFlowError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ServerFlowError";
    this.status = status;
    this.code = code;
  }
}

function toPanelServer(server: OwnedServer): PanelServer {
  // A server with a command in flight offers none: the provider is mid-change,
  // and a second command would race the first.
  const available = server.pendingJobKind
    ? []
    : (Object.keys(SERVER_COMMANDS) as ServerCommand[]).filter((command) =>
        canCommandServer(server.status, command),
      );

  const memoryMb = getPlan(server.planId).ram * 1_024;

  return {
    serverId: server.serverId,
    name: server.name,
    status: server.status,
    gameId: server.gameId,
    softwareId: server.softwareId,
    planId: server.planId,
    regionId: server.regionId,
    connection: server.connection,
    busyWith: server.pendingJobKind,
    availableCommands: available,
    settingFields: settingFields(server.gameId, memoryMb),
    settings: normalizeStoredSettings(server.gameId, memoryMb, server.settings),
    canEditSettings: !server.pendingJobKind &&
      supportsSettings(server.gameId) &&
      (SETTINGS_ALLOWED_STATUSES as readonly string[]).includes(server.status),
    schedule: server.schedule,
    scheduleDescription: server.schedule ? describeSchedule(server.schedule) : null,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
  };
}

export function createServerService(dependencies: ServerServiceDependencies) {
  const now = dependencies.now ?? (() => new Date());

  function report(error: unknown) {
    try {
      dependencies.onOperationalError?.(error);
    } catch {
      // Observability must never change what the customer sees.
    }
  }

  async function requireSession(rawToken: string) {
    const session = await dependencies.auth.authenticateSession(rawToken);
    if (!session) {
      throw new AuthFlowError(401, "SESSION_REQUIRED", "Bu işlem için giriş yapılmalıdır.");
    }
    return session;
  }

  return {
    /** The signed-in customer's own servers. Never anybody else's. */
    async listServers(rawToken: string): Promise<{ servers: PanelServer[] }> {
      const session = await requireSession(rawToken);

      try {
        const owned = await dependencies.servers.listServersForOwner(session.userId);
        return { servers: owned.map(toPanelServer) };
      } catch (error) {
        report(error);
        throw new ServerFlowError(503, "SERVERS_UNAVAILABLE", "Sunucu listesi şu anda okunamadı.");
      }
    },

    /** One server with its recent history, for its owner only. */
    async readServer(rawToken: string, serverId: string): Promise<{
      server: PanelServer;
      events: ServerEvent[];
    }> {
      const session = await requireSession(rawToken);

      let owned: OwnedServer[];
      try {
        owned = await dependencies.servers.listServersForOwner(session.userId);
      } catch (error) {
        report(error);
        throw new ServerFlowError(503, "SERVERS_UNAVAILABLE", "Sunucu şu anda okunamadı.");
      }

      const server = owned.find((candidate) => candidate.serverId === serverId);
      // A stranger's server answers exactly like a missing one.
      if (!server) throw new ServerFlowError(404, "SERVER_NOT_FOUND", "Sunucu bulunamadı.");

      try {
        return { server: toPanelServer(server), events: await dependencies.servers.listServerEvents(serverId) };
      } catch (error) {
        report(error);
        throw new ServerFlowError(503, "SERVERS_UNAVAILABLE", "Sunucu geçmişi şu anda okunamadı.");
      }
    },

    /**
     * Queues one start, stop or restart.
     *
     * The state check happens here rather than in the panel: a client that
     * skips the disabled button must still get the same refusal.
     */
    async commandServer(input: { rawToken: string; serverId: string; command: ServerCommand }) {
      const session = await requireSession(input.rawToken);

      let owned: OwnedServer[];
      try {
        owned = await dependencies.servers.listServersForOwner(session.userId);
      } catch (error) {
        report(error);
        throw new ServerFlowError(503, "SERVERS_UNAVAILABLE", "Sunucu şu anda okunamadı.");
      }

      const server = owned.find((candidate) => candidate.serverId === input.serverId);
      if (!server) throw new ServerFlowError(404, "SERVER_NOT_FOUND", "Sunucu bulunamadı.");

      if (server.pendingJobKind) {
        throw new ServerFlowError(409, "SERVER_BUSY", "Sunucuda bekleyen bir işlem var.");
      }
      if (!canCommandServer(server.status, input.command)) {
        throw new ServerFlowError(409, "COMMAND_NOT_ALLOWED", "Sunucu bu durumdayken bu işlem yapılamaz.");
      }

      try {
        const queued = await dependencies.servers.enqueueLifecycleJob({
          serverId: input.serverId,
          ownerUserId: session.userId,
          kind: SERVER_COMMANDS[input.command],
          now: now(),
        });
        return { jobId: queued.jobId, queued: queued.created };
      } catch (error) {
        report(error);
        throw new ServerFlowError(503, "COMMAND_UNAVAILABLE", "İstek şu anda sıraya alınamadı.");
      }
    },

    /**
     * Sets or clears the daily restart.
     *
     * The next run is computed here rather than in SQL so the arithmetic stays
     * in one tested place, and stored so the worker can find due work with an
     * index instead of recomputing a wall clock per server on every poll.
     */
    async saveSchedule(input: { rawToken: string; serverId: string; schedule: unknown }) {
      const session = await requireSession(input.rawToken);

      const validation = validateSchedule(input.schedule);
      if (!validation.ok) throw new ServerFlowError(400, validation.code, validation.message);

      const now = dependencies.now?.() ?? new Date();
      try {
        const outcome = await dependencies.servers.saveSchedule({
          serverId: input.serverId,
          ownerUserId: session.userId,
          kind: validation.schedule.kind,
          hour: validation.schedule.hour,
          minute: validation.schedule.minute,
          offsetMinutes: validation.schedule.offsetMinutes,
          enabled: validation.schedule.enabled,
          nextRunAt: nextRunAt(validation.schedule, now),
          now,
        });
        if (outcome.status !== "saved") {
          throw new ServerFlowError(404, "SERVER_NOT_FOUND", "Sunucu bulunamadı.");
        }
        return {
          saved: true,
          schedule: validation.schedule,
          message: describeSchedule(validation.schedule),
        };
      } catch (error) {
        if (error instanceof ServerFlowError) throw error;
        report(error);
        throw new ServerFlowError(503, "SCHEDULE_UNAVAILABLE", "Zamanlama şu anda kaydedilemedi.");
      }
    },

    /**
     * Saves runtime settings and queues the restart that makes them real.
     *
     * The panel is told plainly that this restarts the server: the runtime
     * reads its configuration at boot, so there is no way to change difficulty
     * or player count without one, and hiding that would surprise players who
     * are online at the time.
     */
    async saveSettings(input: { rawToken: string; serverId: string; settings: unknown }) {
      const session = await requireSession(input.rawToken);

      let owned: OwnedServer[];
      try {
        owned = await dependencies.servers.listServersForOwner(session.userId);
      } catch (error) {
        report(error);
        throw new ServerFlowError(503, "SERVERS_UNAVAILABLE", "Sunucu şu anda okunamadı.");
      }

      const server = owned.find((candidate) => candidate.serverId === input.serverId);
      // A stranger's server answers exactly like a missing one.
      if (!server) throw new ServerFlowError(404, "SERVER_NOT_FOUND", "Sunucu bulunamadı.");
      if (server.pendingJobKind) {
        throw new ServerFlowError(409, "SERVER_BUSY", "Sunucuda bekleyen bir işlem var.");
      }
      if (!(SETTINGS_ALLOWED_STATUSES as readonly string[]).includes(server.status)) {
        throw new ServerFlowError(409, "SETTINGS_NOT_ALLOWED", "Sunucu bu durumdayken ayar değiştirilemez.");
      }

      const memoryMb = getPlan(server.planId).ram * 1_024;
      const validation = validateSettings(server.gameId, memoryMb, input.settings);
      if (!validation.ok) {
        throw new ServerFlowError(400, validation.code, validation.message);
      }

      try {
        const outcome = await dependencies.servers.saveSettings({
          serverId: input.serverId,
          ownerUserId: session.userId,
          settings: validation.settings,
          allowedStatuses: [...SETTINGS_ALLOWED_STATUSES],
          now: now(),
        });
        if (outcome.status === "not_found") {
          throw new ServerFlowError(404, "SERVER_NOT_FOUND", "Sunucu bulunamadı.");
        }
        if (outcome.status === "not_allowed") {
          throw new ServerFlowError(409, "SETTINGS_NOT_ALLOWED", "Sunucu bu durumdayken ayar değiştirilemez.");
        }
        if (outcome.status !== "queued") {
          throw new ServerFlowError(409, "SERVER_BUSY", "Sunucuda bekleyen bir işlem var.");
        }
        return {
          saved: true,
          jobId: outcome.jobId,
          settings: validation.settings,
          message: "Ayarlar kaydedildi; sunucu yeni ayarlarla yeniden başlatılıyor.",
        };
      } catch (error) {
        if (error instanceof ServerFlowError) throw error;
        report(error);
        throw new ServerFlowError(503, "SETTINGS_UNAVAILABLE", "Ayarlar şu anda kaydedilemedi.");
      }
    },
  };
}

export type ServerService = ReturnType<typeof createServerService>;
