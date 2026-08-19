import { createGameConsole } from "../infra/gameservers/console-access.ts";
import type { GameConsole } from "../infra/gameservers/console-access.ts";
import { createConsoleService, type ConsoleService } from "./console-service.ts";
import { resolveServerService, type ServerCompositionOverrides } from "./server-composition.ts";
import type { AuthEnvironment } from "./auth-runtime.ts";

export type ConsoleCompositionOverrides = ServerCompositionOverrides & {
  consoleService?: ConsoleService;
  gameConsole?: GameConsole;
};

export type ConsoleResolution =
  | { status: "not_configured"; missing: string[] }
  | { status: "adapter_not_bound" }
  | { status: "ready"; service: ConsoleService };

/**
 * Wires the console onto the panel's own server service.
 *
 * Ownership comes from `listServers`, which already enforces it, so the console
 * inherits exactly the same boundary the rest of the panel has.
 */
export function resolveConsoleService(
  environment: AuthEnvironment,
  overrides: ConsoleCompositionOverrides = {},
): ConsoleResolution {
  if (overrides.consoleService) return { status: "ready", service: overrides.consoleService };

  const servers = resolveServerService(environment, overrides);
  if (servers.status !== "ready") {
    return servers.status === "not_configured"
      ? { status: "not_configured", missing: servers.missing }
      : { status: "adapter_not_bound" };
  }

  // Absent on an edge runtime or without a secret to derive the password from.
  const gameConsole = overrides.gameConsole ?? createGameConsole(environment);
  if (!gameConsole) return { status: "adapter_not_bound" };

  return {
    status: "ready",
    service: createConsoleService({
      servers: servers.service,
      console: gameConsole,
      onOperationalError: overrides.onOperationalError,
    }),
  };
}
