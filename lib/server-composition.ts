import { createAuthRepository, createSqlExecutor } from "../infra/postgres/driver-binding.ts";
import { PostgresProvisioningRepository } from "../infra/postgres/provisioning-repository.ts";
import { resolveSessionAuthService, type AuthCompositionOverrides } from "./auth-composition.ts";
import type { AuthEnvironment } from "./auth-runtime.ts";
import { createServerService, type ServerService } from "./server-service.ts";

export type ServerCompositionOverrides = AuthCompositionOverrides & {
  serverService?: ServerService;
};

export type ServerResolution =
  | { status: "not_configured"; missing: string[] }
  | { status: "adapter_not_bound" }
  | { status: "ready"; service: ServerService };

/**
 * Wires the panel to real server data.
 *
 * Only a session check and the database are required. A customer can see and
 * control a server they already have even when payments are switched off and
 * new sign-ins cannot be delivered — which is exactly the closed-beta
 * situation.
 */
export function resolveServerService(
  environment: AuthEnvironment,
  overrides: ServerCompositionOverrides = {},
): ServerResolution {
  if (overrides.serverService) return { status: "ready", service: overrides.serverService };

  const auth = resolveSessionAuthService(environment, overrides);
  if (auth.status !== "ready") {
    return auth.status === "not_configured"
      ? { status: "not_configured", missing: auth.missing }
      : { status: "adapter_not_bound" };
  }

  const repository = "repository" in overrides ? overrides.repository : createAuthRepository(environment);
  const executor = createSqlExecutor(environment);
  if (!repository || !executor) return { status: "adapter_not_bound" };

  return {
    status: "ready",
    service: createServerService({
      auth: auth.service,
      servers: new PostgresProvisioningRepository(executor),
      onOperationalError: overrides.onOperationalError,
    }),
  };
}
