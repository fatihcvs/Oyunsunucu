import type { AuthEnvironment } from "../../lib/auth-runtime.ts";

export const RCON_PORT = 25_575;

export interface GameConsole {
  run(input: { serverId: string; command: string }): Promise<string>;
}

export class ConsoleError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ConsoleError";
    this.code = code;
  }
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * The console password for one server, derived rather than stored.
 *
 * A password kept in the database would be one more secret to protect, rotate
 * and leak; derived from `AUTH_SECRET` it can be recomputed wherever it is
 * needed and exists nowhere at rest. Rotating `AUTH_SECRET` therefore also
 * rotates every console password, and servers created before the rotation need
 * their variables reapplied — that is the deliberate trade.
 */
export async function deriveRconPassword(
  secret: string,
  serverId: string,
  cryptoSource: Crypto = globalThis.crypto,
) {
  if (new TextEncoder().encode(secret).byteLength < 32) {
    throw new TypeError("Konsol parolası türetmek için en az 32 baytlık bir sır gerekir.");
  }
  const key = await cryptoSource.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await cryptoSource.subtle.sign("HMAC", key, new TextEncoder().encode(`rcon:${serverId}`));
  // 24 bytes is well past guessing range and stays inside what the game accepts.
  return bytesToBase64Url(new Uint8Array(digest).subarray(0, 24));
}

/** Where a Railway-hosted game service answers on the project's private network. */
export function privateConsoleHost(serverId: string) {
  return `game-${serverId}.railway.internal`;
}

type NodeRconModule = typeof import("./node-rcon-client.ts");

function isNodeRuntime() {
  return typeof process !== "undefined" && Boolean(process.versions?.node);
}

/**
 * The console as the panel uses it.
 *
 * The socket module is imported lazily, for the same reason the database driver
 * is: `node:net` cannot load on an edge runtime, and importing it eagerly would
 * break every route that merely touches the composition root.
 *
 * The connection goes over the provider's private network, so the derived
 * password never travels the public internet and the RCON port is never exposed
 * by a proxy.
 */
export function createGameConsole(environment: AuthEnvironment): GameConsole | null {
  const secret = environment.AUTH_SECRET?.trim() ?? "";
  if (!isNodeRuntime() || new TextEncoder().encode(secret).byteLength < 32) return null;

  return {
    async run(input) {
      const { runRconCommand, RconError } = await (import("./node-rcon-client.ts") as Promise<NodeRconModule>);
      const password = await deriveRconPassword(secret, input.serverId);

      try {
        return await runRconCommand({
          host: privateConsoleHost(input.serverId),
          port: RCON_PORT,
          password,
          command: input.command,
        });
      } catch (error) {
        if (error instanceof RconError) throw new ConsoleError(error.code, error.message);
        throw new ConsoleError("RCON_UNREACHABLE", "Sunucunun konsoluna ulaşılamadı.");
      }
    },
  };
}
