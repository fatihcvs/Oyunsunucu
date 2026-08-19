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
  createdAt: string;
  updatedAt: string;
};

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
  };
}

export type ServerService = ReturnType<typeof createServerService>;
