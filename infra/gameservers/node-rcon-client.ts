import net from "node:net";
import {
  RCON_AUTH_FAILED_ID,
  RCON_PACKET,
  decodeRconPackets,
  encodeRconPacket,
  type RconPacket,
} from "./rcon-protocol.ts";

export type RconRunInput = {
  host: string;
  port: number;
  password: string;
  command: string;
  timeoutMs?: number;
};

export class RconError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RconError";
    this.code = code;
  }
}

const DEFAULT_TIMEOUT_MS = 8_000;
/** How long to keep listening after the first response packet, for split output. */
const DRAIN_MS = 120;

/**
 * Runs one command over RCON and returns what the server printed.
 *
 * A fresh connection per command rather than a pool: commands are rare, the
 * handshake is two packets, and a pooled socket to a server that restarts under
 * us is a source of confusing failures rather than saved milliseconds.
 */
export function runRconCommand(input: RconRunInput): Promise<string> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<string>((resolve, reject) => {
    const socket = net.createConnection({ host: input.host, port: input.port });
    socket.setTimeout(timeoutMs);

    let buffered = new Uint8Array(0);
    let authenticated = false;
    let output = "";
    let drainTimer: NodeJS.Timeout | null = null;
    let settled = false;

    const finish = (error: RconError | null) => {
      if (settled) return;
      settled = true;
      if (drainTimer) clearTimeout(drainTimer);
      socket.destroy();
      if (error) reject(error);
      else resolve(output.trim());
    };

    socket.on("connect", () => {
      socket.write(encodeRconPacket({ id: 1, type: RCON_PACKET.auth, body: input.password }));
    });

    socket.on("data", (chunk) => {
      const merged = new Uint8Array(buffered.byteLength + chunk.byteLength);
      merged.set(buffered, 0);
      merged.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), buffered.byteLength);

      let packets: RconPacket[];
      try {
        const decoded = decodeRconPackets(merged);
        packets = decoded.packets;
        // The remainder is a view into `merged`; copy it so the next read's
        // allocation does not alias a buffer we still hold.
        buffered = new Uint8Array(decoded.rest);
      } catch {
        finish(new RconError("RCON_PROTOCOL", "Sunucu anlaşılmayan bir yanıt gönderdi."));
        return;
      }

      for (const packet of packets) {
        if (!authenticated) {
          if (packet.type !== RCON_PACKET.command) continue;
          if (packet.id === RCON_AUTH_FAILED_ID) {
            finish(new RconError("RCON_AUTH_REJECTED", "Konsol parolası kabul edilmedi."));
            return;
          }
          authenticated = true;
          socket.write(encodeRconPacket({ id: 2, type: RCON_PACKET.command, body: input.command }));
          continue;
        }

        output += packet.body;
        // Long output arrives as several packets; wait briefly for the rest.
        if (drainTimer) clearTimeout(drainTimer);
        drainTimer = setTimeout(() => finish(null), DRAIN_MS);
      }
    });

    socket.on("timeout", () => {
      finish(new RconError(
        authenticated ? "RCON_TIMEOUT" : "RCON_UNREACHABLE",
        authenticated ? "Sunucu komuta zamanında yanıt vermedi." : "Sunucunun konsoluna ulaşılamadı.",
      ));
    });

    socket.on("error", (error: NodeJS.ErrnoException) => {
      finish(new RconError("RCON_UNREACHABLE", `Sunucunun konsoluna ulaşılamadı (${error.code ?? "hata"}).`));
    });

    socket.on("close", () => {
      if (settled) return;
      finish(authenticated
        ? null
        : new RconError("RCON_UNREACHABLE", "Konsol bağlantısı doğrulanmadan kapandı."));
    });
  });
}
