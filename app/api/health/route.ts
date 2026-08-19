import { jsonNoStore } from "../../../lib/auth-http.ts";
import { getAuthRuntimeReadiness, type AuthEnvironment } from "../../../lib/auth-runtime.ts";
import { createSqlExecutor } from "../../../infra/postgres/driver-binding.ts";

export const dynamic = "force-dynamic";

export type HealthProbe = {
  checkDatabase?: (environment: AuthEnvironment) => Promise<boolean>;
};

/** A single round-trip proves the pool can reach the database, not just that a URL exists. */
async function pingDatabase(environment: AuthEnvironment) {
  const executor = createSqlExecutor(environment);
  if (!executor) return false;

  try {
    const result = await executor.query<{ ok: unknown }>("SELECT 1 AS ok");
    return result.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}

/**
 * Deployment health for the platform's health check.
 *
 * Reports `degraded` rather than failing when the database is unreachable: the
 * site still serves its public pages, so replacing a running instance over a
 * transient database blip would make an outage worse. Only a process that
 * cannot answer at all is unhealthy.
 */
export async function createHealthResponse(
  environment: AuthEnvironment,
  probe: HealthProbe = {},
) {
  const readiness = getAuthRuntimeReadiness(environment);
  const database = await (probe.checkDatabase ?? pingDatabase)(environment);

  return jsonNoStore({
    status: database ? "ok" : "degraded",
    database,
    auth: {
      configured: readiness.ready,
      magicLink: readiness.checks.magicLink,
      discord: readiness.checks.discord,
    },
  });
}

export function GET() {
  return createHealthResponse(process.env);
}
