import { createBackupStore } from "../infra/gameservers/volume-backups.ts";
import type { BackupStore } from "../infra/gameservers/volume-backups.ts";
import { createBackupService, type BackupService } from "./backup-service.ts";
import { resolveServerService, type ServerCompositionOverrides } from "./server-composition.ts";
import { PostgresProvisioningRepository } from "../infra/postgres/provisioning-repository.ts";
import { createSqlExecutor } from "../infra/postgres/driver-binding.ts";
import { resolveSessionAuthService } from "./auth-composition.ts";
import type { AuthEnvironment } from "./auth-runtime.ts";

export type BackupCompositionOverrides = ServerCompositionOverrides & {
  backupService?: BackupService;
  backupStore?: BackupStore;
};

export type BackupResolution =
  | { status: "not_configured"; missing: string[] }
  | { status: "adapter_not_bound" }
  | { status: "ready"; service: BackupService };

export function resolveBackupService(
  environment: AuthEnvironment,
  overrides: BackupCompositionOverrides = {},
): BackupResolution {
  if (overrides.backupService) return { status: "ready", service: overrides.backupService };

  const servers = resolveServerService(environment, overrides);
  if (servers.status !== "ready") {
    return servers.status === "not_configured"
      ? { status: "not_configured", missing: servers.missing }
      : { status: "adapter_not_bound" };
  }

  const auth = resolveSessionAuthService(environment, overrides);
  if (auth.status !== "ready") return { status: "adapter_not_bound" };

  const store = overrides.backupStore ?? createBackupStore(environment);
  const executor = createSqlExecutor(environment);
  if (!store || !executor) return { status: "adapter_not_bound" };

  return {
    status: "ready",
    service: createBackupService({
      servers: servers.service,
      auth: auth.service,
      store,
      queue: new PostgresProvisioningRepository(executor),
      onOperationalError: overrides.onOperationalError,
    }),
  };
}
