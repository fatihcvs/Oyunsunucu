import { createGameConsole } from "../infra/gameservers/console-access.ts";
import { createServerMetricsSource } from "../infra/gameservers/server-metrics.ts";
import type { ServerMetricsSource } from "../infra/gameservers/server-metrics.ts";
import { createMetricsService, type MetricsService } from "./metrics-service.ts";
import { resolveServerService, type ServerCompositionOverrides } from "./server-composition.ts";
import type { AuthEnvironment } from "./auth-runtime.ts";

export type MetricsCompositionOverrides = ServerCompositionOverrides & {
  metricsService?: MetricsService;
  metricsSource?: ServerMetricsSource;
};

export type MetricsResolution =
  | { status: "not_configured"; missing: string[] }
  | { status: "adapter_not_bound" }
  | { status: "ready"; service: MetricsService };

export function resolveMetricsService(
  environment: AuthEnvironment,
  overrides: MetricsCompositionOverrides = {},
): MetricsResolution {
  if (overrides.metricsService) return { status: "ready", service: overrides.metricsService };

  const servers = resolveServerService(environment, overrides);
  if (servers.status !== "ready") {
    return servers.status === "not_configured"
      ? { status: "not_configured", missing: servers.missing }
      : { status: "adapter_not_bound" };
  }

  const metricsSource = overrides.metricsSource ?? createServerMetricsSource(environment);
  if (!metricsSource) return { status: "adapter_not_bound" };

  return {
    status: "ready",
    service: createMetricsService({
      servers: servers.service,
      metrics: metricsSource,
      // The player count is a bonus: without a console the card still shows
      // CPU and memory rather than nothing.
      console: createGameConsole(environment) ?? undefined,
      onOperationalError: overrides.onOperationalError,
    }),
  };
}
