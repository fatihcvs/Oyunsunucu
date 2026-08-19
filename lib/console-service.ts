import { AuthFlowError } from "./auth-service.ts";
import type { GameConsole } from "../infra/gameservers/console-access.ts";
import { ConsoleError } from "../infra/gameservers/console-access.ts";
import type { PanelServer, ServerService } from "./server-service.ts";

export class ConsoleFlowError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ConsoleFlowError";
    this.status = status;
    this.code = code;
  }
}

export const CONSOLE_MAX_COMMAND_LENGTH = 300;

/**
 * Commands the panel refuses to send.
 *
 * Not a security boundary — RCON is an admin channel and the customer owns the
 * server — but a consistency one. `stop` would halt the container behind the
 * state machine's back, leaving the panel showing "online" for a server that is
 * gone; the panel's own stop button exists and keeps the record straight.
 */
const REFUSED_COMMANDS = new Set(["stop", "restart", "reload"]);

/** One-click player actions, so the common cases need no command syntax. */
export const PLAYER_ACTIONS = {
  whitelist_add: { verb: "whitelist add", label: "Beyaz listeye ekle", needsPlayer: true },
  whitelist_remove: { verb: "whitelist remove", label: "Beyaz listeden çıkar", needsPlayer: true },
  op: { verb: "op", label: "Yetkili yap", needsPlayer: true },
  deop: { verb: "deop", label: "Yetkiyi al", needsPlayer: true },
  kick: { verb: "kick", label: "Oyundan at", needsPlayer: true },
  ban: { verb: "ban", label: "Yasakla", needsPlayer: true },
  pardon: { verb: "pardon", label: "Yasağı kaldır", needsPlayer: true },
  list: { verb: "list", label: "Çevrimiçi oyuncular", needsPlayer: false },
} as const satisfies Record<string, { verb: string; label: string; needsPlayer: boolean }>;

export type PlayerAction = keyof typeof PLAYER_ACTIONS;

export function isPlayerAction(value: unknown): value is PlayerAction {
  return typeof value === "string" && value in PLAYER_ACTIONS;
}

/** Minecraft names are 3-16 of `[A-Za-z0-9_]`; anything else cannot be a player. */
const PLAYER_NAME = /^[A-Za-z0-9_]{3,16}$/;

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

export type ConsoleServiceDependencies = {
  servers: Pick<ServerService, "listServers">;
  console: GameConsole;
  onOperationalError?: (error: unknown) => void;
};

export type ConsoleService = ReturnType<typeof createConsoleService>;

/**
 * The in-panel console.
 *
 * Ownership is decided by the panel's own server list, so the console can never
 * be pointed at a server the caller does not own. The connection itself runs
 * over the provider's private network from the server side; the password is
 * derived there and never reaches the browser.
 */
export function createConsoleService(dependencies: ConsoleServiceDependencies) {
  function report(error: unknown) {
    try { dependencies.onOperationalError?.(error); } catch { /* Observability must not alter the result. */ }
  }

  async function requireOwnedServer(rawToken: string, serverId: unknown): Promise<PanelServer> {
    if (typeof serverId !== "string" || !serverId) {
      throw new ConsoleFlowError(400, "SERVER_ID_REQUIRED", "Sunucu kimliği gerekli.");
    }

    let servers: PanelServer[];
    try {
      ({ servers } = await dependencies.servers.listServers(rawToken));
    } catch (error) {
      if (error instanceof AuthFlowError) throw error;
      report(error);
      throw new ConsoleFlowError(503, "CONSOLE_UNAVAILABLE", "Sunucu şu anda okunamadı.");
    }

    const server = servers.find((candidate) => candidate.serverId === serverId);
    // A stranger's server answers exactly like a missing one.
    if (!server) throw new ConsoleFlowError(404, "SERVER_NOT_FOUND", "Sunucu bulunamadı.");
    if (server.gameId !== "minecraft") {
      throw new ConsoleFlowError(409, "CONSOLE_UNSUPPORTED", "Bu oyun için konsol henüz yok.");
    }
    if (server.status !== "online") {
      throw new ConsoleFlowError(409, "SERVER_NOT_ONLINE", "Konsol yalnızca çalışan sunucuda kullanılabilir.");
    }
    return server;
  }

  async function send(server: PanelServer, command: string) {
    try {
      const output = await dependencies.console.run({ serverId: server.serverId, command });
      return { command, output: output || "(sunucu bir çıktı döndürmedi)" };
    } catch (error) {
      if (error instanceof ConsoleError) {
        throw new ConsoleFlowError(
          error.code === "RCON_AUTH_REJECTED" ? 409 : 503,
          error.code,
          error.message,
        );
      }
      report(error);
      throw new ConsoleFlowError(503, "CONSOLE_UNAVAILABLE", "Konsol şu anda kullanılamıyor.");
    }
  }

  return {
    /** Runs a raw command the customer typed. */
    async runCommand(input: { rawToken: string; serverId: unknown; command: unknown }) {
      const server = await requireOwnedServer(input.rawToken, input.serverId);

      const command = typeof input.command === "string" ? input.command.trim().replace(/^\//, "") : "";
      if (!command || command.length > CONSOLE_MAX_COMMAND_LENGTH || hasControlCharacter(command)) {
        throw new ConsoleFlowError(400, "INVALID_COMMAND", "Komut geçersiz.");
      }
      const verb = command.split(/\s+/)[0].toLowerCase();
      if (REFUSED_COMMANDS.has(verb)) {
        throw new ConsoleFlowError(
          400,
          "COMMAND_REFUSED",
          "Bu komut panelden kapalı; sunucuyu durdurmak veya yeniden başlatmak için üstteki butonları kullan.",
        );
      }

      return send(server, command);
    },

    /** Runs one of the named player actions, so the common cases need no syntax. */
    async runPlayerAction(input: { rawToken: string; serverId: unknown; action: unknown; player: unknown }) {
      const server = await requireOwnedServer(input.rawToken, input.serverId);
      if (!isPlayerAction(input.action)) {
        throw new ConsoleFlowError(400, "UNKNOWN_ACTION", "Bilinmeyen oyuncu işlemi.");
      }

      const action = PLAYER_ACTIONS[input.action];
      const player = typeof input.player === "string" ? input.player.trim() : "";
      if (action.needsPlayer && !PLAYER_NAME.test(player)) {
        throw new ConsoleFlowError(400, "INVALID_PLAYER", "Oyuncu adı 3-16 karakter olmalı ve yalnızca harf, rakam ve alt çizgi içermelidir.");
      }

      return send(server, action.needsPlayer ? `${action.verb} ${player}` : action.verb);
    },
  };
}
