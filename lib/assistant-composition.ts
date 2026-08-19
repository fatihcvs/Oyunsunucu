import {
  createAssistantService,
  createClaudeAssistantModel,
  type AssistantModel,
  type AssistantService,
} from "./assistant-service.ts";
import type { AssistantServerContext } from "./assistant-contracts.ts";
import { resolveServerService, type ServerCompositionOverrides } from "./server-composition.ts";
import type { AuthEnvironment } from "./auth-runtime.ts";

export type AssistantCompositionOverrides = ServerCompositionOverrides & {
  assistantService?: AssistantService;
  assistantModel?: AssistantModel;
};

export type AssistantResolution =
  | { status: "not_configured"; missing: string[] }
  | { status: "adapter_not_bound" }
  | { status: "ready"; service: AssistantService };

/**
 * Wires the assistant onto the panel's own server service.
 *
 * The context it reasons over comes from `listServers`, which already enforces
 * ownership — so the assistant cannot be pointed at a server the caller does
 * not own, no matter what the model is told.
 */
export function resolveAssistantService(
  environment: AuthEnvironment,
  overrides: AssistantCompositionOverrides = {},
): AssistantResolution {
  if (overrides.assistantService) return { status: "ready", service: overrides.assistantService };

  const apiKey = environment.ANTHROPIC_API_KEY?.trim() ?? "";
  if (!overrides.assistantModel && !apiKey) {
    return { status: "not_configured", missing: ["ANTHROPIC_API_KEY"] };
  }

  const servers = resolveServerService(environment, overrides);
  if (servers.status !== "ready") {
    return servers.status === "not_configured"
      ? { status: "not_configured", missing: servers.missing }
      : { status: "adapter_not_bound" };
  }

  const model = overrides.assistantModel ?? createClaudeAssistantModel({
    apiKey,
    model: environment.ASSISTANT_MODEL,
  });

  return {
    status: "ready",
    service: createAssistantService({
      model,
      onOperationalError: overrides.onOperationalError,
      async loadServers(rawToken): Promise<AssistantServerContext[]> {
        const { servers: owned } = await servers.service.listServers(rawToken);
        return owned.map((server) => ({
          serverId: server.serverId,
          name: server.name,
          gameId: server.gameId,
          softwareId: server.softwareId,
          planId: server.planId,
          regionId: server.regionId,
          status: server.status,
          settings: server.settings,
          availableCommands: server.availableCommands,
          canEditSettings: server.canEditSettings,
          busyWith: server.busyWith,
        }));
      },
    }),
  };
}
