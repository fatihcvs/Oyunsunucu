import type { AuthEnvironment } from "../../lib/auth-runtime.ts";

export type MetricPoint = { at: string; value: number };

export type ServerMetrics = {
  /** Fractions of a vCPU, as the provider reports them. */
  cpu: MetricPoint[];
  /** Gigabytes resident, which includes the JVM heap and everything around it. */
  memoryGb: MetricPoint[];
  /** What the provider would actually cap the container at, when it says. */
  providerMemoryLimitGb: number | null;
  sampledFrom: string;
  sampledTo: string;
};

export interface ServerMetricsSource {
  read(input: { serverId: string; from: Date; to: Date }): Promise<ServerMetrics | null>;
}

const RAILWAY_API_URL = "https://backboard.railway.com/graphql/v2";
const SAMPLE_SECONDS = 300;
const REQUEST_TIMEOUT_MS = 15_000;

type MetricsResponse = {
  data?: { metrics?: { measurement: string; values: { ts: number; value: number }[] }[] };
  errors?: { message: string }[];
};

function toPoints(values: { ts: number; value: number }[]): MetricPoint[] {
  return values.map((point) => ({
    // Railway reports seconds; the panel wants an instant it can format.
    at: new Date(point.ts * 1_000).toISOString(),
    value: point.value,
  }));
}

/**
 * Reads what the provider measured for one game service.
 *
 * Separate from `GameServerProvider` on purpose: reading a graph is not part of
 * creating or destroying a server, and a provider that cannot report metrics
 * should still be able to host. A source that returns null simply means the
 * panel shows no chart.
 */
export function createRailwayMetricsSource(options: {
  apiToken: string;
  projectId: string;
  environmentId: string;
  fetch?: typeof fetch;
}): ServerMetricsSource {
  const send = options.fetch ?? fetch;

  async function findServiceId(name: string): Promise<string | null> {
    const body = await graphql<{ project: { services: { edges: { node: { id: string; name: string } }[] } } }>(
      `query($id: String!) { project(id: $id) { services { edges { node { id name } } } } }`,
      { id: options.projectId },
    );
    const match = body?.project.services.edges.find((edge) => edge.node.name === name);
    return match?.node.id ?? null;
  }

  async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await send(RAILWAY_API_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const body = await response.json() as { data?: T; errors?: unknown[] };
      // Metrics are a nice-to-have: a provider hiccup must not turn into an
      // error banner over a working server.
      return body.errors?.length ? null : body.data ?? null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async read(input) {
      const serviceId = await findServiceId(`game-${input.serverId}`);
      if (!serviceId) return null;

      const body = await graphql<MetricsResponse["data"]>(
        `query($measurements: [MetricMeasurement!]!, $serviceId: String!, $environmentId: String!,
               $projectId: String!, $startDate: DateTime!, $endDate: DateTime!, $sampleRateSeconds: Int!) {
           metrics(measurements: $measurements, serviceId: $serviceId, environmentId: $environmentId,
                   projectId: $projectId, startDate: $startDate, endDate: $endDate,
                   sampleRateSeconds: $sampleRateSeconds) {
             measurement
             values { ts value }
           }
         }`,
        {
          measurements: ["CPU_USAGE", "MEMORY_USAGE_GB", "MEMORY_LIMIT_GB"],
          serviceId,
          environmentId: options.environmentId,
          projectId: options.projectId,
          startDate: input.from.toISOString(),
          endDate: input.to.toISOString(),
          sampleRateSeconds: SAMPLE_SECONDS,
        },
      );
      if (!body?.metrics) return null;

      const series = new Map(body.metrics.map((entry) => [entry.measurement, entry.values]));
      const limits = series.get("MEMORY_LIMIT_GB") ?? [];

      return {
        cpu: toPoints(series.get("CPU_USAGE") ?? []),
        memoryGb: toPoints(series.get("MEMORY_USAGE_GB") ?? []),
        providerMemoryLimitGb: limits.at(-1)?.value ?? null,
        sampledFrom: input.from.toISOString(),
        sampledTo: input.to.toISOString(),
      };
    },
  };
}

/** Absent configuration means no charts, not a broken panel. */
export function createServerMetricsSource(environment: AuthEnvironment): ServerMetricsSource | null {
  const apiToken = environment.RAILWAY_API_TOKEN?.trim() ?? "";
  const projectId = environment.RAILWAY_GAME_PROJECT_ID?.trim() ?? "";
  const environmentId = environment.RAILWAY_GAME_ENVIRONMENT_ID?.trim() ?? "";
  if (!apiToken || !projectId || !environmentId) return null;

  return createRailwayMetricsSource({ apiToken, projectId, environmentId });
}
