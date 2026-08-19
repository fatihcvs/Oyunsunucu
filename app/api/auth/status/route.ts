import { jsonNoStore } from "../../../../lib/auth-http.ts";
import {
  resolveAuthService,
  type AuthCompositionOverrides,
} from "../../../../lib/auth-composition.ts";
import {
  getAuthRuntimeReadiness,
  type AuthEnvironment,
} from "../../../../lib/auth-runtime.ts";

export const dynamic = "force-dynamic";

const STATE_BY_RESOLUTION = {
  ready: "live",
  adapter_not_bound: "adapter_required",
  not_configured: "configuration_required",
} as const;

export function createAuthStatusResponse(
  environment: AuthEnvironment,
  overrides: AuthCompositionOverrides = {},
) {
  const runtime = getAuthRuntimeReadiness(environment);
  const resolution = resolveAuthService(environment, overrides);
  const live = resolution.status === "ready";

  return jsonNoStore({
    state: STATE_BY_RESOLUTION[resolution.status],
    live,
    checks: {
      ...runtime.checks,
      postgresAdapter: live,
    },
    missing: runtime.missing,
  });
}

export function GET() {
  return createAuthStatusResponse(process.env);
}
