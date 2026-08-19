import { PostgresAdminCredentialsRepository } from "../infra/postgres/admin-credentials-repository.ts";
import { PostgresAdminRepository } from "../infra/postgres/admin-repository.ts";
import { createSqlExecutor } from "../infra/postgres/driver-binding.ts";
import {
  createAdminService,
  type AdminMembershipRepository,
  type AdminRepository,
  type AdminService,
} from "./admin-service.ts";
import { resolveSessionAuthService, type AuthCompositionOverrides } from "./auth-composition.ts";
import type { AuthEnvironment } from "./auth-runtime.ts";
import { createRailwayGameServerProvider } from "../infra/gameservers/railway-provider.ts";

/**
 * Reads the truth from the provider, for reconciliation only.
 *
 * A server the provider still gives an address for is running, whatever the
 * database says. Absent credentials simply mean reconciliation is unavailable.
 */
function observeThroughProvider(environment: AuthEnvironment) {
  const apiToken = environment.RAILWAY_API_TOKEN?.trim() ?? "";
  const projectId = environment.RAILWAY_GAME_PROJECT_ID?.trim() ?? "";
  const environmentId = environment.RAILWAY_GAME_ENVIRONMENT_ID?.trim() ?? "";
  if (!apiToken || !projectId || !environmentId) return undefined;

  const provider = createRailwayGameServerProvider({
    apiToken,
    projectId,
    environmentId,
    minecraftEulaAccepted: environment.MINECRAFT_EULA_ACCEPTED === "true",
  });

  return async (serverId: string) => {
    try {
      return { reachable: Boolean(await provider.getConnectionInfo(serverId)) };
    } catch {
      return null;
    }
  };
}

export type AdminCompositionOverrides = AuthCompositionOverrides & {
  adminService?: AdminService;
  adminRepository?: AdminRepository;
  membershipRepository?: AdminMembershipRepository;
  observeServer?: (serverId: string) => Promise<{ reachable: boolean } | null>;
};

export type AdminResolution =
  | { status: "not_configured"; missing: string[] }
  | { status: "adapter_not_bound" }
  | { status: "ready"; service: AdminService };

export function resolveAdminService(
  environment: AuthEnvironment,
  overrides: AdminCompositionOverrides = {},
): AdminResolution {
  if (overrides.adminService) return { status: "ready", service: overrides.adminService };

  const auth = resolveSessionAuthService(environment, overrides);
  if (auth.status !== "ready") {
    return auth.status === "not_configured"
      ? { status: "not_configured", missing: auth.missing }
      : { status: "adapter_not_bound" };
  }

  const executor = createSqlExecutor(environment);
  const repository = overrides.adminRepository ?? (executor ? new PostgresAdminRepository(executor) : null);
  const memberships = overrides.membershipRepository ??
    (executor ? new PostgresAdminCredentialsRepository(executor) : null);
  if (!repository || !memberships) return { status: "adapter_not_bound" };

  return {
    status: "ready",
    service: createAdminService({
      auth: auth.service,
      repository,
      memberships,
      observeServer: overrides.observeServer ?? observeThroughProvider(environment),
      onOperationalError: overrides.onOperationalError,
    }),
  };
}
