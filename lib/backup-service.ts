import type { BackupRecord, BackupStore } from "../infra/gameservers/volume-backups.ts";
import { BackupError } from "../infra/gameservers/volume-backups.ts";
import type { PanelServer, ServerService } from "./server-service.ts";
import { ServerFlowError } from "./server-service.ts";
import type { PostgresProvisioningRepository } from "../infra/postgres/provisioning-repository.ts";

/** What one server may hold before an older snapshot has to go. */
export const BACKUP_LIMIT_PER_SERVER = 5;

export type BackupServiceDependencies = {
  servers: Pick<ServerService, "listServers">;
  /** The panel deliberately never exposes the owner id, so the queue gets it from here. */
  auth: { authenticateSession(rawToken: string): Promise<{ userId: string } | null> };
  store: BackupStore;
  queue: Pick<PostgresProvisioningRepository, "enqueueLifecycleJob">;
  now?: () => Date;
  onOperationalError?: (error: unknown) => void;
};

export type BackupService = ReturnType<typeof createBackupService>;

/**
 * Manual world backups.
 *
 * Taking one is queued rather than done inline: the world has to be flushed and
 * held still first, which is worker work, and it shares the one-operation-per-
 * server rule with every other job. Listing and deleting are immediate, because
 * neither touches the running server.
 */
export function createBackupService(dependencies: BackupServiceDependencies) {
  const now = dependencies.now ?? (() => new Date());

  function report(error: unknown) {
    try { dependencies.onOperationalError?.(error); } catch { /* Observability must not alter the result. */ }
  }

  async function requireOwnedServer(rawToken: string, serverId: unknown): Promise<PanelServer> {
    if (typeof serverId !== "string" || !serverId) {
      throw new ServerFlowError(400, "SERVER_ID_REQUIRED", "Sunucu kimliği gerekli.");
    }
    const { servers } = await dependencies.servers.listServers(rawToken);
    const server = servers.find((candidate) => candidate.serverId === serverId);
    // A stranger's server answers exactly like a missing one.
    if (!server) throw new ServerFlowError(404, "SERVER_NOT_FOUND", "Sunucu bulunamadı.");
    return server;
  }

  function toFlowError(error: unknown, fallback: string): ServerFlowError {
    if (error instanceof ServerFlowError) return error;
    if (error instanceof BackupError) {
      return new ServerFlowError(error.retryable ? 503 : 409, error.code, error.message);
    }
    report(error);
    return new ServerFlowError(503, "BACKUP_UNAVAILABLE", fallback);
  }

  return {
    async listBackups(rawToken: string, serverId: unknown): Promise<{
      backups: BackupRecord[];
      limit: number;
      canCreate: boolean;
    }> {
      const server = await requireOwnedServer(rawToken, serverId);
      try {
        const backups = await dependencies.store.list(server.serverId);
        return {
          backups,
          limit: BACKUP_LIMIT_PER_SERVER,
          canCreate: !server.busyWith && backups.length < BACKUP_LIMIT_PER_SERVER,
        };
      } catch (error) {
        throw toFlowError(error, "Yedekler şu anda okunamadı.");
      }
    },

    /** Queues a snapshot; the worker flushes the world before the provider takes it. */
    async createBackup(rawToken: string, serverId: unknown) {
      const server = await requireOwnedServer(rawToken, serverId);
      if (server.busyWith) {
        throw new ServerFlowError(409, "SERVER_BUSY", "Sunucuda bekleyen bir işlem var.");
      }

      let existing: BackupRecord[];
      try {
        existing = await dependencies.store.list(server.serverId);
      } catch (error) {
        throw toFlowError(error, "Yedekler şu anda okunamadı.");
      }
      // A cap rather than silently deleting the oldest: a backup the customer
      // still wants must not disappear because they asked for a new one.
      if (existing.length >= BACKUP_LIMIT_PER_SERVER) {
        throw new ServerFlowError(
          409,
          "BACKUP_LIMIT_REACHED",
          `En fazla ${BACKUP_LIMIT_PER_SERVER} yedek tutulabilir. Yeni yedek için birini silin.`,
        );
      }

      const session = await dependencies.auth.authenticateSession(rawToken);
      if (!session) throw new ServerFlowError(401, "SESSION_REQUIRED", "Bu işlem için giriş yapılmalıdır.");

      try {
        const queued = await dependencies.queue.enqueueLifecycleJob({
          serverId: server.serverId,
          ownerUserId: session.userId,
          kind: "create_backup",
          now: now(),
        });
        return { queued: queued.created, jobId: queued.jobId, message: "Yedek alma sıraya alındı." };
      } catch (error) {
        throw toFlowError(error, "Yedek şu anda sıraya alınamadı.");
      }
    },

    async deleteBackup(rawToken: string, serverId: unknown, backupId: unknown) {
      const server = await requireOwnedServer(rawToken, serverId);
      if (typeof backupId !== "string" || !backupId) {
        throw new ServerFlowError(400, "BACKUP_ID_REQUIRED", "Yedek kimliği gerekli.");
      }

      try {
        // Checked against this server's own list, so a backup id belonging to
        // another server cannot be deleted by guessing it.
        const owned = await dependencies.store.list(server.serverId);
        if (!owned.some((backup) => backup.id === backupId)) {
          throw new ServerFlowError(404, "BACKUP_NOT_FOUND", "Yedek bulunamadı.");
        }
        await dependencies.store.remove({ serverId: server.serverId, backupId });
        return { deleted: true, message: "Yedek silindi." };
      } catch (error) {
        throw toFlowError(error, "Yedek şu anda silinemedi.");
      }
    },
  };
}
