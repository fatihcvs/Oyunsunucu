import { PostgresAdminCredentialsRepository } from "../infra/postgres/admin-credentials-repository.ts";
import { PostgresAuthRepository } from "../infra/postgres/auth-repository.ts";
import { createSqlExecutor } from "../infra/postgres/driver-binding.ts";
import {
  createAdminPasswordService,
  type AdminPasswordRateLimiter,
  type AdminPasswordRepository,
  type AdminPasswordService,
} from "./admin-password-service.ts";
import { resolveSessionAuthService, type AuthCompositionOverrides } from "./auth-composition.ts";
import { isValidEmail, normalizeEmail } from "./auth-contracts.ts";
import { isAdminPasswordHash } from "./auth-security.ts";
import { isDeliverableAppOrigin, type AuthEnvironment } from "./auth-runtime.ts";

export type AdminPasswordCompositionOverrides = AuthCompositionOverrides & {
  service?: AdminPasswordService;
  rateLimiter?: AdminPasswordRateLimiter;
  repository?: AdminPasswordRepository;
  now?: () => Date;
  onOperationalError?: (error: unknown) => void;
};

export type AdminPasswordResolution =
  | { status: "not_configured"; missing: string[] }
  | { status: "adapter_not_bound" }
  | { status: "ready"; service: AdminPasswordService };

export function resolveAdminPasswordService(
  environment: AuthEnvironment,
  overrides: AdminPasswordCompositionOverrides = {},
): AdminPasswordResolution {
  if (overrides.service) return { status: "ready", service: overrides.service };

  const bootstrapEmail = environment.ADMIN_LOGIN_EMAIL?.trim() ?? "";
  const bootstrapPasswordHash = environment.ADMIN_PASSWORD_HASH?.trim() ?? "";
  const rateLimitSecret = environment.AUTH_SECRET?.trim() ?? "";
  const missing = [
    !environment.DATABASE_URL?.trim() ? "DATABASE_URL" : null,
    !isDeliverableAppOrigin(environment.APP_ORIGIN?.trim() ?? "") ? "APP_ORIGIN" : null,
    new TextEncoder().encode(rateLimitSecret).byteLength < 32 ? "AUTH_SECRET" : null,
    !isValidEmail(bootstrapEmail) ? "ADMIN_LOGIN_EMAIL" : null,
    !isAdminPasswordHash(bootstrapPasswordHash) ? "ADMIN_PASSWORD_HASH" : null,
  ].filter((name): name is string => Boolean(name));
  if (missing.length > 0) return { status: "not_configured", missing };

  const auth = resolveSessionAuthService(environment, overrides);
  if (auth.status !== "ready") {
    return auth.status === "not_configured"
      ? { status: "not_configured", missing: auth.missing }
      : { status: "adapter_not_bound" };
  }

  const executor = createSqlExecutor(environment);
  if (!executor) return { status: "adapter_not_bound" };
  const rateLimiter = overrides.rateLimiter ?? new PostgresAuthRepository(executor);
  const repository = overrides.repository ?? new PostgresAdminCredentialsRepository(executor);

  return {
    status: "ready",
    service: createAdminPasswordService({
      bootstrapEmail: normalizeEmail(bootstrapEmail),
      bootstrapPasswordHash,
      rateLimitSecret,
      rateLimiter,
      repository,
      auth: auth.service,
      now: overrides.now,
      onOperationalError: overrides.onOperationalError,
    }),
  };
}
