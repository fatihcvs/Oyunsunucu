import { getPlan } from "./catalog.ts";
import { normalizeStoredSettings } from "./server-settings.ts";
import { nextRunAt } from "./schedule-contracts.ts";
import { heapMegabytes } from "../infra/gameservers/runtime-catalog.ts";
import { findGameRuntime } from "../infra/gameservers/runtime-catalog.ts";
import { ProviderError, type GameServerProvider } from "../infra/gameservers/provider.ts";
import type { ClaimedJob, PostgresProvisioningRepository } from "../infra/postgres/provisioning-repository.ts";

export type WorkerDependencies = {
  repository: PostgresProvisioningRepository;
  provider: GameServerProvider;
  owner: string;
  now?: () => Date;
  onOperationalError?: (error: unknown) => void;
};

const CUSTOMER_MESSAGES = {
  online: "Sunucun hazır ve bağlanabilirsin.",
  retrying: "Kurulum beklenenden uzun sürüyor, yeniden deneniyor.",
  dead: "Kurulum tamamlanamadı. Destek ekibi bilgilendirildi ve ücretin güvende.",
} as const;

/**
 * Applies one claimed job to the provider.
 *
 * Every resource the provider reports is recorded **before** the job is marked
 * done, so a failure halfway through still leaves a trail to clean up. That is
 * what keeps a failed setup from leaving an orphaned service or volume behind.
 */
export function createProvisioningWorker(dependencies: WorkerDependencies) {
  const now = dependencies.now ?? (() => new Date());

  async function runCreateServer(job: ClaimedJob) {
    if (!job.serverId) throw new ProviderError("create_server", "İş bir sunucuya bağlı değil.", false);

    const server = await dependencies.repository.findServer(job.serverId);
    if (!server) throw new ProviderError("create_server", "Sunucu kaydı bulunamadı.", false);

    const runtime = findGameRuntime(server.gameId, server.softwareId);
    if (!runtime?.image) {
      // Not retryable: no amount of waiting produces an image for a
      // combination the catalog cannot host.
      throw new ProviderError("create_server", `Çalışma ortamı çözülmemiş: ${server.gameId}/${server.softwareId}`, false);
    }

    const plan = getPlan(server.planId);
    const memoryMb = plan.ram * 1024;
    if (memoryMb < runtime.minimumMemoryMb) {
      throw new ProviderError("create_server", `${server.planId} bu çalışma ortamı için yetersiz.`, false);
    }

    await dependencies.repository.markServerStatus(job.serverId, "requested", "provisioning", now());

    const provisioned = await dependencies.provider.createServer({
      serverId: job.serverId,
      name: server.name,
      runtime,
      memoryMb,
      storageGb: plan.storage,
      regionId: server.regionId,
      settings: normalizeStoredSettings(server.gameId, memoryMb, server.settings),
    });

    for (const resource of provisioned.resources) {
      await dependencies.repository.recordProviderResource({
        serverId: job.serverId,
        provider: dependencies.provider.name,
        resourceKind: resource.kind,
        providerResourceId: resource.id,
        now: now(),
      });
    }

    await dependencies.repository.markServerStatus(job.serverId, "provisioning", "deploying", now());
    const connection = provisioned.connection ?? await dependencies.provider.getConnectionInfo(job.serverId);

    await dependencies.repository.completeJob({
      jobId: job.jobId,
      serverId: job.serverId,
      serverStatus: connection ? "online" : "failed",
      connection,
      customerMessage: connection ? CUSTOMER_MESSAGES.online : "Sunucu adresi alınamadı.",
      now: now(),
    });

    return { heapMb: heapMegabytes(memoryMb), connection };
  }

  /** A lifecycle job without a server is a broken row, not a transient failure. */
  function requireServerId(job: ClaimedJob) {
    if (!job.serverId) throw new ProviderError(job.kind, "İş bir sunucuya bağlı değil.", false);
    return job.serverId;
  }

  const HANDLERS = {
    create_server: runCreateServer,
    start_server: async (job) => {
      await dependencies.provider.startServer(requireServerId(job));
      await dependencies.repository.completeJob({
        jobId: job.jobId,
        serverId: job.serverId,
        serverStatus: "online",
        customerMessage: "Sunucu başlatıldı.",
        now: now(),
      });
    },
    stop_server: async (job) => {
      await dependencies.provider.stopServer(requireServerId(job));
      await dependencies.repository.completeJob({
        jobId: job.jobId,
        serverId: job.serverId,
        serverStatus: "suspended",
        customerMessage: "Sunucu durduruldu.",
        now: now(),
      });
    },
    restart_server: async (job) => {
      await dependencies.provider.restartServer(requireServerId(job));
      await dependencies.repository.completeJob({
        jobId: job.jobId,
        serverId: job.serverId,
        serverStatus: "online",
        customerMessage: "Sunucu yeniden başlatıldı.",
        now: now(),
      });
    },
    resize_server: async (job) => {
      const serverId = requireServerId(job);
      const server = await dependencies.repository.findServer(serverId);
      if (!server) throw new ProviderError("resize_server", "Sunucu kaydı bulunamadı.", false);

      const runtime = findGameRuntime(server.gameId, server.softwareId);
      if (!runtime?.image) {
        throw new ProviderError("resize_server", "Çalışma ortamı çözülmemiş.", false);
      }
      const plan = getPlan(server.planId);
      const memoryMb = plan.ram * 1024;
      if (memoryMb < runtime.minimumMemoryMb) {
        throw new ProviderError("resize_server", `${server.planId} bu çalışma ortamı için yetersiz.`, false);
      }

      await dependencies.provider.resizeServer({
        serverId,
        name: server.name,
        runtime,
        memoryMb,
        storageGb: plan.storage,
        regionId: server.regionId,
        settings: normalizeStoredSettings(server.gameId, memoryMb, server.settings),
      });

      await dependencies.repository.completeJob({
        jobId: job.jobId,
        serverId: job.serverId,
        serverStatus: "online",
        customerMessage: `Sunucu ${plan.label} paketine (${plan.ram} GB) taşındı.`,
        now: now(),
      });
    },
    apply_settings: async (job) => {
      const serverId = requireServerId(job);
      const server = await dependencies.repository.findServer(serverId);
      if (!server) throw new ProviderError("apply_settings", "Sunucu kaydı bulunamadı.", false);

      const runtime = findGameRuntime(server.gameId, server.softwareId);
      if (!runtime?.image) {
        throw new ProviderError("apply_settings", "Çalışma ortamı çözülmemiş.", false);
      }
      const plan = getPlan(server.planId);
      const memoryMb = plan.ram * 1024;

      await dependencies.provider.applySettings({
        serverId,
        name: server.name,
        runtime,
        memoryMb,
        storageGb: plan.storage,
        regionId: server.regionId,
        settings: normalizeStoredSettings(server.gameId, memoryMb, server.settings),
      });

      await dependencies.repository.completeJob({
        jobId: job.jobId,
        serverId: job.serverId,
        serverStatus: "online",
        customerMessage: "Yeni ayarlar uygulandı ve sunucu yeniden başlatıldı.",
        now: now(),
      });
    },
    delete_server: async (job) => {
      await dependencies.provider.deleteServer(requireServerId(job));
      await dependencies.repository.completeJob({
        jobId: job.jobId,
        serverId: job.serverId,
        serverStatus: "deleted",
        customerMessage: "Sunucu silindi.",
        now: now(),
      });
    },
  } satisfies Record<string, (job: ClaimedJob) => Promise<unknown>>;

  return {
    /**
     * Fires one due scheduled restart, if any is due.
     *
     * Separate from the job tick so a busy queue cannot starve the scheduler,
     * and so a scheduler fault cannot stop jobs from draining.
     */
    async runScheduleOnce() {
      try {
        return await dependencies.repository.claimDueSchedule({ now: now(), nextRunAt });
      } catch (error) {
        // A scheduler failure must not take the worker down with it: jobs still
        // need draining, and the next tick will try again.
        try { dependencies.onOperationalError?.(error); } catch { /* ignore */ }
        return null;
      }
    },

    /** Claims and applies one job. Returns false when the queue is empty. */
    async runOnce() {
      const job = await dependencies.repository.claimJob(dependencies.owner, now());
      if (!job) return false;

      try {
        await HANDLERS[job.kind](job);
        return true;
      } catch (error) {
        const providerError = error instanceof ProviderError ? error : null;
        const detail = error instanceof Error ? error.message : String(error);
        try {
          dependencies.onOperationalError?.(error);
        } catch {
          // Observability must never change the provisioning outcome.
        }

        // An unrecoverable job is buried immediately rather than burning four
        // more attempts on something that cannot succeed.
        const attempts = providerError && !providerError.retryable ? Number.MAX_SAFE_INTEGER : job.attempts;
        const outcome = await dependencies.repository.failJob({
          jobId: job.jobId,
          serverId: job.serverId,
          attempts,
          operatorDetail: detail,
          customerMessage: attempts === job.attempts ? CUSTOMER_MESSAGES.retrying : CUSTOMER_MESSAGES.dead,
          now: now(),
        });
        return outcome.retrying;
      }
    },
  };
}

export type ProvisioningWorker = ReturnType<typeof createProvisioningWorker>;
