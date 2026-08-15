import { jsonNoStore } from "../../../../lib/auth-http.ts";
import {
  getAuthRuntimeReadiness,
  type AuthEnvironment,
} from "../../../../lib/auth-runtime.ts";

export const dynamic = "force-dynamic";

export function createAuthStatusResponse(environment: AuthEnvironment) {
  const runtime = getAuthRuntimeReadiness(environment);
  return jsonNoStore({
    state: runtime.ready ? "adapter_required" : "configuration_required",
    live: false,
    checks: {
      ...runtime.checks,
      postgresAdapter: false,
    },
    missing: runtime.missing,
  });
}

export function GET() {
  return createAuthStatusResponse(process.env);
}
