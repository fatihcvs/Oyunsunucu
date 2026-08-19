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

export type AdminCompositionOverrides = AuthCompositionOverrides & {
  adminService?: AdminService;
  adminRepository?: AdminRepository;
  membershipRepository?: AdminMembershipRepository;
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
      onOperationalError: overrides.onOperationalError,
    }),
  };
}
