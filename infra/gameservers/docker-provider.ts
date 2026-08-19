import { execFile } from "node:child_process";
import { settingsToContainerVariables } from "../../lib/server-settings.ts";
import { promisify } from "node:util";
import { heapMegabytes } from "./runtime-catalog.ts";
import {
  ProviderError,
  type GameServerProvider,
  type ProvisionedServer,
  type ServerSpec,
} from "./provider.ts";

const run = promisify(execFile);

export type DockerProviderOptions = {
  /** Public hostname players connect to. */
  publicHost: string;
  /** Set by the operator to accept Mojang's EULA for the servers they run. */
  minecraftEulaAccepted: boolean;
  namePrefix?: string;
};

/**
 * Runs game servers as containers on the host.
 *
 * This is a real provider, not a stub: it creates containers and volumes and
 * reports what it made. It exists so the provisioning pipeline can be proven
 * end to end before a cloud provider's API token is available, and it stays
 * useful afterwards for local work and for a single-box deployment.
 */
export function createDockerGameServerProvider(options: DockerProviderOptions): GameServerProvider {
  const prefix = options.namePrefix ?? "riftory-srv";
  const containerName = (serverId: string) => `${prefix}-${serverId}`;
  const volumeName = (serverId: string) => `${prefix}-${serverId}-data`;

  async function docker(args: string[], operation: string, { allowFailure = false } = {}) {
    try {
      const { stdout, stderr } = await run("docker", args, { maxBuffer: 16 * 1024 * 1024 });
      return `${stdout}${stderr}`;
    } catch (error) {
      if (allowFailure) return "";
      const detail = (error as { stderr?: string }).stderr || (error as Error).message;
      // A missing daemon or an exhausted host is worth retrying; a rejected
      // argument never becomes valid on its own.
      const retryable = !/unknown flag|invalid reference|no such image/i.test(detail);
      throw new ProviderError(operation, detail.trim().slice(0, 500), retryable);
    }
  }

  /** Per-game container settings, derived from the certified runtimes. */
  function environmentFor(spec: ServerSpec) {
    return [
      ...baseEnvironmentFor(spec),
      ...Object.entries(settingsToContainerVariables(spec.runtime.gameId, spec.settings ?? {}, spec.name))
        .flatMap(([key, value]) => ["-e", `${key}=${value}`]),
    ];
  }

  function baseEnvironmentFor(spec: ServerSpec) {
    const { runtime } = spec;
    if (runtime.gameId === "minecraft") {
      if (!options.minecraftEulaAccepted) {
        throw new ProviderError(
          "create_server",
          "Minecraft sunucusu Mojang EULA kabulü gerektirir; operatör onayı verilmemiş.",
          false,
        );
      }
      return [
        "-e", "EULA=TRUE",
        "-e", `TYPE=${runtime.softwareId.toUpperCase()}`,
        "-e", `VERSION=${runtime.gameVersion}`,
        "-e", `MEMORY=${heapMegabytes(spec.memoryMb)}M`,
        "-e", "ENABLE_RCON=true",
        "-e", "ONLINE_MODE=TRUE",
        "-e", "LEVEL=world",
      ];
    }
    if (runtime.gameId === "terraria") {
      return [
        "-e", `WORLD_NAME=${spec.name.replace(/[^A-Za-z0-9]/g, "") || "Riftory"}`,
        "-e", `WORLD_DIR=${runtime.dataPath}`,
        "-e", `PORT=${runtime.containerPort}`,
      ];
    }
    return [];
  }

  async function publishedPort(serverId: string, containerPort: number) {
    const mapping = await docker(
      ["port", containerName(serverId), `${containerPort}/tcp`],
      "get_connection",
      { allowFailure: true },
    );
    const port = mapping.match(/:(\d+)\s*$/m)?.[1];
    return port ? Number(port) : null;
  }

  return {
    name: "docker",

    async createServer(spec: ServerSpec): Promise<ProvisionedServer> {
      if (!spec.runtime.image) {
        throw new ProviderError("create_server", "Çalışma ortamı imajı sabitlenmemiş.", false);
      }

      const container = containerName(spec.serverId);
      const volume = volumeName(spec.serverId);

      // Creating the same server twice must not produce a second container: an
      // existing one is adopted rather than duplicated.
      const existing = await docker(["ps", "-aq", "--filter", `name=^${container}$`], "create_server", { allowFailure: true });
      if (!existing.trim()) {
        await docker(["volume", "create", volume], "create_server");
        await docker([
          "run", "-d",
          "--name", container,
          "--restart", "unless-stopped",
          "--memory", `${spec.memoryMb}m`,
          "--memory-swap", `${spec.memoryMb}m`,
          "--label", "riftory.server-id=" + spec.serverId,
          "-p", `0:${spec.runtime.containerPort}`,
          "-v", `${volume}:${spec.runtime.dataPath}`,
          ...environmentFor(spec),
          spec.runtime.image,
        ], "create_server");
      }

      const port = await publishedPort(spec.serverId, spec.runtime.containerPort);
      return {
        resources: [
          { kind: "container", id: container },
          { kind: "volume", id: volume },
        ],
        connection: port ? { host: options.publicHost, port } : null,
      };
    },

    async startServer(serverId: string) {
      await docker(["start", containerName(serverId)], "start_server");
    },

    /**
     * Recreates the container with the new environment.
     *
     * Docker cannot rewrite the environment of an existing container, and the
     * runtime only reads its configuration at boot. The volume is untouched, so
     * the world survives; only the container identity changes.
     */
    /** Same recreate as a settings change; the memory flags come from the new plan. */
    async resizeServer(spec: ServerSpec) {
      await this.applySettings(spec);
    },

    async applySettings(spec: ServerSpec) {
      const container = containerName(spec.serverId);
      const volume = volumeName(spec.serverId);
      if (!spec.runtime.image) {
        throw new ProviderError("apply_settings", "Çalışma ortamı imajı sabitlenmemiş.", false);
      }

      await docker(["rm", "-f", container], "apply_settings", { allowFailure: true });
      await docker([
        "run", "-d",
        "--name", container,
        "--restart", "unless-stopped",
        "--memory", `${spec.memoryMb}m`,
        "--memory-swap", `${spec.memoryMb}m`,
        "--label", "riftory.server-id=" + spec.serverId,
        "-p", `0:${spec.runtime.containerPort}`,
        "-v", `${volume}:${spec.runtime.dataPath}`,
        ...environmentFor(spec),
        spec.runtime.image,
      ], "apply_settings");
    },

    async stopServer(serverId: string) {
      // The timeout matches the certified graceful shutdown paths, so a save
      // has time to finish before the runtime is killed.
      await docker(["stop", "--timeout", "120", containerName(serverId)], "stop_server");
    },

    async restartServer(serverId: string) {
      await docker(["restart", "--time", "120", containerName(serverId)], "restart_server");
    },

    async deleteServer(serverId: string) {
      await docker(["rm", "--force", containerName(serverId)], "delete_server", { allowFailure: true });
      await docker(["volume", "rm", "--force", volumeName(serverId)], "delete_server", { allowFailure: true });
    },

    async getConnectionInfo(serverId: string) {
      const inspect = await docker(
        ["inspect", "-f", "{{range $p, $c := .NetworkSettings.Ports}}{{$p}}{{end}}", containerName(serverId)],
        "get_connection",
        { allowFailure: true },
      );
      const containerPort = Number(inspect.match(/(\d+)\/tcp/)?.[1] ?? 0);
      if (!containerPort) return null;

      const port = await publishedPort(serverId, containerPort);
      return port ? { host: options.publicHost, port } : null;
    },
  };
}
