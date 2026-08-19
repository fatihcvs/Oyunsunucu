import type { ServerMetrics, ServerMetricsSource } from "../infra/gameservers/server-metrics.ts";
import type { GameConsole } from "../infra/gameservers/console-access.ts";
import { getPlan } from "./catalog.ts";
import { heapMegabytes } from "../infra/gameservers/runtime-catalog.ts";
import type { PanelServer, ServerService } from "./server-service.ts";
import { ServerFlowError } from "./server-service.ts";

export type PlayerCount = { online: number; max: number; names: string[] };

export type ServerMetricsView = {
  window: { from: string; to: string };
  cpu: ServerMetrics["cpu"];
  memoryGb: ServerMetrics["memoryGb"];
  /** What the customer bought, which is what the chart is measured against. */
  planMemoryGb: number;
  /** The heap the runtime is actually started with, after the off-heap reserve. */
  heapMemoryGb: number;
  players: PlayerCount | null;
  /** True when memory sits above what the plan sells, not merely spikes above it. */
  overPlan: boolean;
};

export const METRICS_WINDOW_MS = 60 * 60_000;

/**
 * The memory level a server actually sits at, as the median sample.
 *
 * Not the peak, and the reason is measured rather than theoretical: during a
 * rolling redeploy the provider runs the old and new containers at once, so the
 * series shows a sample at roughly twice the real figure. Reading the peak
 * turned that transition into a permanent "over your plan" warning on a server
 * comfortably inside its plan. The median ignores a couple of transition
 * samples while still crossing the line if usage genuinely stays high.
 */
export function sustainedMemoryGb(points: MetricPointLike[]): number {
  if (points.length === 0) return 0;
  const sorted = points.map((point) => point.value).sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

type MetricPointLike = { value: number };

/**
 * Parses Minecraft's `list` output.
 *
 * The wording has been stable for years, but a parse failure must not take the
 * whole card down: an unreadable line simply means no player count.
 */
export function parsePlayerList(output: string): PlayerCount | null {
  const match = /There are (\d+) of a max of (\d+) players online:?(.*)/i.exec(output.trim());
  if (!match) return null;

  const names = match[3]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return { online: Number(match[1]), max: Number(match[2]), names };
}

export type MetricsServiceDependencies = {
  servers: Pick<ServerService, "listServers">;
  metrics: ServerMetricsSource;
  console?: GameConsole;
  now?: () => Date;
  onOperationalError?: (error: unknown) => void;
};

export type MetricsService = ReturnType<typeof createMetricsService>;

/**
 * Resource usage for one server the caller owns.
 *
 * The chart is measured against the plan, not against the provider's container
 * limit: Railway hands the container far more memory than the plan sells, and
 * showing that number would tell the customer they have resources they did not
 * buy — and that we cannot promise to keep.
 */
export function createMetricsService(dependencies: MetricsServiceDependencies) {
  const now = dependencies.now ?? (() => new Date());

  function report(error: unknown) {
    try { dependencies.onOperationalError?.(error); } catch { /* Observability must not alter the result. */ }
  }

  async function requireOwnedServer(rawToken: string, serverId: unknown): Promise<PanelServer> {
    if (typeof serverId !== "string" || !serverId) {
      throw new ServerFlowError(400, "SERVER_ID_REQUIRED", "Sunucu kimliği gerekli.");
    }
    const { servers } = await dependencies.servers.listServers(rawToken);
    const server = servers.find((candidate) => candidate.serverId === serverId);
    // A stranger's server answers exactly like a missing one.
    if (!server) throw new ServerFlowError(404, "SERVER_NOT_FOUND", "Sunucu bulunamadı.");
    return server;
  }

  async function readPlayers(server: PanelServer): Promise<PlayerCount | null> {
    if (!dependencies.console || server.gameId !== "minecraft" || server.status !== "online") return null;
    try {
      return parsePlayerList(await dependencies.console.run({ serverId: server.serverId, command: "list" }));
    } catch (error) {
      // A console that is briefly unreachable costs the player count, nothing more.
      report(error);
      return null;
    }
  }

  return {
    async readMetrics(rawToken: string, serverId: unknown): Promise<ServerMetricsView> {
      const server = await requireOwnedServer(rawToken, serverId);
      const to = now();
      const from = new Date(to.getTime() - METRICS_WINDOW_MS);

      const plan = getPlan(server.planId);
      const planMemoryGb = plan.ram;
      const heapMemoryGb = Number((heapMegabytes(plan.ram * 1_024) / 1_024).toFixed(2));

      let measured: ServerMetrics | null = null;
      try {
        measured = await dependencies.metrics.read({ serverId: server.serverId, from, to });
      } catch (error) {
        report(error);
      }

      const memoryGb = measured?.memoryGb ?? [];

      return {
        window: { from: from.toISOString(), to: to.toISOString() },
        cpu: measured?.cpu ?? [],
        memoryGb,
        planMemoryGb,
        heapMemoryGb,
        players: await readPlayers(server),
        overPlan: sustainedMemoryGb(memoryGb) > planMemoryGb,
      };
    },
  };
}
