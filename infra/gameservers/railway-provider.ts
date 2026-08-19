import { heapMegabytes } from "./runtime-catalog.ts";
import { settingsToContainerVariables } from "../../lib/server-settings.ts";
import {
  ProviderError,
  type GameServerProvider,
  type ProvisionedServer,
  type ServerSpec,
} from "./provider.ts";

export const RAILWAY_API_URL = "https://backboard.railway.com/graphql/v2";

export type RailwayProviderOptions = {
  apiToken: string;
  projectId: string;
  environmentId: string;
  /** Railway region for the game services, e.g. `europe-west4`. */
  region?: string;
  minecraftEulaAccepted: boolean;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

type GraphQlResult<T> = { data?: T; errors?: { message: string }[] };

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Creates game servers as Railway services.
 *
 * Written against the schema as it actually answers, not as documented:
 * `tcpProxyCreate` is absent from introspection but callable, and it is the
 * only way to give a game server a reachable address — an HTTP domain cannot
 * carry the Minecraft or Terraria protocol.
 */
export function createRailwayGameServerProvider(options: RailwayProviderOptions): GameServerProvider {
  const send = options.fetch ?? globalThis.fetch;
  const serviceName = (serverId: string) => `game-${serverId}`;

  async function graphql<T>(operation: string, query: string, variables: Record<string, unknown> = {}) {
    let response: Response;
    try {
      response = await send(RAILWAY_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.apiToken}`,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new ProviderError(operation, "Railway API'ye ulaşılamadı.", true);
    }

    const body = await response.json().catch(() => null) as GraphQlResult<T> | null;
    if (!response.ok || !body) {
      throw new ProviderError(operation, `Railway API ${response.status}`, response.status >= 500);
    }
    if (body.errors?.length) {
      const message = body.errors.map((error) => error.message).join("; ").slice(0, 300);
      // An authorisation or validation failure will not fix itself on retry.
      const retryable = !/not authorized|not found|invalid|already exists/i.test(message);
      throw new ProviderError(operation, message, retryable);
    }
    if (!body.data) throw new ProviderError(operation, "Railway API boş yanıt döndürdü.", true);

    return body.data;
  }

  /** Game-specific container variables, mirroring the certified runtimes. */
  function variablesFor(spec: ServerSpec): Record<string, string> {
    return { ...baseVariablesFor(spec), ...settingsToContainerVariables(spec.runtime.gameId, spec.settings ?? {}, spec.name) };
  }

  function baseVariablesFor(spec: ServerSpec): Record<string, string> {
    const { runtime } = spec;
    if (runtime.gameId === "minecraft") {
      if (!options.minecraftEulaAccepted) {
        throw new ProviderError(
          "create_server",
          "Minecraft sunucusu Mojang EULA kabulü gerektirir; operatör onayı verilmemiş.",
          false,
        );
      }
      return {
        EULA: "TRUE",
        TYPE: runtime.softwareId.toUpperCase(),
        VERSION: runtime.gameVersion,
        MEMORY: `${heapMegabytes(spec.memoryMb)}M`,
        ONLINE_MODE: "TRUE",
        LEVEL: "world",
        SERVER_PORT: String(runtime.containerPort),
      };
    }
    if (runtime.gameId === "terraria") {
      return {
        WORLD_NAME: spec.name.replace(/[^A-Za-z0-9]/g, "") || "Riftory",
        WORLD_DIR: runtime.dataPath,
        PORT: String(runtime.containerPort),
      };
    }
    return {};
  }

  async function findExistingService(name: string) {
    const data = await graphql<{ project: { services: { edges: { node: { id: string; name: string } }[] } } }>(
      "create_server",
      `query($id: String!) { project(id: $id) { services { edges { node { id name } } } } }`,
      { id: options.projectId },
    );
    return data.project.services.edges.find((edge) => edge.node.name === name)?.node.id ?? null;
  }

  /**
   * Railway returns a fully qualified name with a trailing dot. It resolves
   * either way, but the customer copies this into a game client, so the address
   * they see should be the one they would type.
   */
  function playableHost(domain: string) {
    return domain.replace(/\.$/, "");
  }

  async function findProxy(serviceId: string) {
    const data = await graphql<{ tcpProxies: { id: string; domain: string; proxyPort: number }[] }>(
      "get_connection",
      `query($environmentId: String!, $serviceId: String!) {
         tcpProxies(environmentId: $environmentId, serviceId: $serviceId) { id domain proxyPort }
       }`,
      { environmentId: options.environmentId, serviceId },
    );
    return data.tcpProxies[0] ?? null;
  }

  /** Sleeping keeps the volume and the address; deleting would lose both. */
  async function setSleeping(serverId: string, sleeping: boolean, operation: string) {
    const serviceId = await findExistingService(serviceName(serverId));
    if (!serviceId) throw new ProviderError(operation, "Servis bulunamadı.", false);

    await graphql(
      operation,
      `mutation($environmentId: String!, $serviceId: String!, $input: ServiceInstanceUpdateInput!) {
         serviceInstanceUpdate(environmentId: $environmentId, serviceId: $serviceId, input: $input)
       }`,
      { environmentId: options.environmentId, serviceId, input: { sleepApplication: sleeping } },
    );
  }

  return {
    name: "railway",

    async createServer(spec: ServerSpec): Promise<ProvisionedServer> {
      if (!spec.runtime.image) {
        throw new ProviderError("create_server", "Çalışma ortamı imajı sabitlenmemiş.", false);
      }

      const name = serviceName(spec.serverId);
      const variables = variablesFor(spec);

      // Adopt an existing service instead of creating a second one: a retried
      // job must not leave the customer paying for two servers.
      let serviceId = await findExistingService(name);
      if (!serviceId) {
        const created = await graphql<{ serviceCreate: { id: string } }>(
          "create_server",
          `mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }`,
          {
            input: {
              projectId: options.projectId,
              environmentId: options.environmentId,
              name,
              source: { image: spec.runtime.image },
              variables,
            },
          },
        );
        serviceId = created.serviceCreate.id;
      }

      const resources: ProvisionedServer["resources"] = [{ kind: "service", id: serviceId }];

      // The world lives on the volume; without it a redeploy resets the server.
      const volume = await graphql<{ volumeCreate: { id: string } }>(
        "create_server",
        `mutation($input: VolumeCreateInput!) { volumeCreate(input: $input) { id } }`,
        {
          input: {
            projectId: options.projectId,
            environmentId: options.environmentId,
            serviceId,
            mountPath: spec.runtime.dataPath,
          },
        },
      ).catch((error: unknown) => {
        // A volume already attached is the retry case, not a failure.
        if (error instanceof ProviderError && /already/i.test(error.message)) return null;
        throw error;
      });
      if (volume) resources.push({ kind: "volume", id: volume.volumeCreate.id });

      if (options.region) {
        await graphql(
          "create_server",
          `mutation($environmentId: String!, $serviceId: String!, $input: ServiceInstanceUpdateInput!) {
             serviceInstanceUpdate(environmentId: $environmentId, serviceId: $serviceId, input: $input)
           }`,
          {
            environmentId: options.environmentId,
            serviceId,
            input: { region: options.region, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 3 },
          },
        );
      }

      // An HTTP domain cannot carry a game protocol; the TCP proxy is what
      // makes the server reachable at all.
      let proxy = await findProxy(serviceId);
      if (!proxy) {
        const created = await graphql<{ tcpProxyCreate: { id: string; domain: string; proxyPort: number } }>(
          "create_server",
          `mutation($input: TCPProxyCreateInput!) {
             tcpProxyCreate(input: $input) { id domain proxyPort }
           }`,
          {
            input: {
              applicationPort: spec.runtime.containerPort,
              environmentId: options.environmentId,
              serviceId,
            },
          },
        );
        proxy = created.tcpProxyCreate;
      }
      resources.push({ kind: "proxy", id: proxy.id });

      return {
        resources,
        connection: { host: playableHost(proxy.domain), port: proxy.proxyPort },
      };
    },

    async startServer(serverId: string) {
      await setSleeping(serverId, false, "start_server");
    },

    async stopServer(serverId: string) {
      await setSleeping(serverId, true, "stop_server");
    },

    /**
     * Sleeps the service and wakes it again.
     *
     * `deploymentRestart` answers "Deployment is not restartable" for a service
     * that has been slept or is mid-transition, which is exactly the state a
     * customer restarts from. Sleep and wake are the two operations that do
     * work, and together they give the container the stop-then-start the game
     * runtime expects.
     */
    async restartServer(serverId: string) {
      await setSleeping(serverId, true, "restart_server");
      await setSleeping(serverId, false, "restart_server");
    },

    /**
     * Upserts the derived variables and cycles the service.
     *
     * `replace: false` keeps the variables the runtime needs but the customer
     * never sees (EULA, TYPE, MEMORY): a settings change must not be able to
     * strip the server of the values that make it boot at all.
     */
    async applySettings(spec: ServerSpec) {
      const serviceId = await findExistingService(serviceName(spec.serverId));
      if (!serviceId) throw new ProviderError("apply_settings", "Servis bulunamadı.", false);

      await graphql(
        "apply_settings",
        `mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`,
        {
          input: {
            projectId: options.projectId,
            environmentId: options.environmentId,
            serviceId,
            replace: false,
            variables: settingsToContainerVariables(spec.runtime.gameId, spec.settings ?? {}, spec.name),
          },
        },
      );

      await setSleeping(spec.serverId, true, "apply_settings");
      await setSleeping(spec.serverId, false, "apply_settings");
    },

    /**
     * Rewrites the size-dependent variables and cycles the service.
     *
     * The JVM heap is what actually bounds a Minecraft server's memory, and it
     * is fixed at boot, so a resize is a variable change plus a restart. The
     * volume is left alone: it holds the world, and it only ever grows.
     */
    async resizeServer(spec: ServerSpec) {
      const serviceId = await findExistingService(serviceName(spec.serverId));
      if (!serviceId) throw new ProviderError("resize_server", "Servis bulunamadı.", false);

      await graphql(
        "resize_server",
        `mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`,
        {
          input: {
            projectId: options.projectId,
            environmentId: options.environmentId,
            serviceId,
            replace: false,
            variables: variablesFor(spec),
          },
        },
      );

      await setSleeping(spec.serverId, true, "resize_server");
      await setSleeping(spec.serverId, false, "resize_server");
    },

    async deleteServer(serverId: string) {
      const serviceId = await findExistingService(serviceName(serverId));
      if (!serviceId) return;

      const volumes = await graphql<{
        project: { volumes: { edges: { node: { id: string; name: string } }[] } };
      }>(
        "delete_server",
        `query($id: String!) { project(id: $id) { volumes { edges { node { id name } } } } }`,
        { id: options.projectId },
      );

      const prefix = `${serviceName(serverId)}-`;
      for (const edge of volumes.project.volumes.edges) {
        if (!edge.node.name.startsWith(prefix)) continue;
        await graphql(
          "delete_server",
          `mutation($id: String!) { volumeDelete(volumeId: $id) }`,
          { id: edge.node.id },
        );
      }

      await graphql(
        "delete_server",
        `mutation($id: String!, $environmentId: String!) { serviceDelete(id: $id, environmentId: $environmentId) }`,
        { id: serviceId, environmentId: options.environmentId },
      );
    },

    async getConnectionInfo(serverId: string) {
      const serviceId = await findExistingService(serviceName(serverId));
      if (!serviceId) return null;

      const proxy = await findProxy(serviceId);
      return proxy ? { host: playableHost(proxy.domain), port: proxy.proxyPort } : null;
    },
  };
}
