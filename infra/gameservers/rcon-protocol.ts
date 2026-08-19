/**
 * Source RCON wire format, which Minecraft speaks.
 *
 * Kept apart from any socket so the framing can be tested without a server:
 * the encode/decode pair is where the subtle bugs live, not the TCP call.
 *
 * Packet layout, all little-endian:
 *   int32 length   — bytes after this field
 *   int32 id       — echoed back, which is how auth success is recognised
 *   int32 type
 *   byte[] body    — null-terminated
 *   byte  0        — trailing pad
 */
export const RCON_PACKET = {
  /** Client → server: authenticate. */
  auth: 3,
  /** Client → server: run a command. Also the server's auth reply type. */
  command: 2,
  /** Server → client: command output. */
  response: 0,
} as const;

export type RconPacket = { id: number; type: number; body: string };

/** The id a server sends when authentication failed. */
export const RCON_AUTH_FAILED_ID = -1;

const HEADER_BYTES = 12;
const MAX_PACKET_BYTES = 4_096;

export function encodeRconPacket(packet: RconPacket): Uint8Array {
  const body = new TextEncoder().encode(packet.body);
  const total = HEADER_BYTES + body.byteLength + 2;
  const buffer = new Uint8Array(total);
  const view = new DataView(buffer.buffer);

  view.setInt32(0, total - 4, true);
  view.setInt32(4, packet.id, true);
  view.setInt32(8, packet.type, true);
  buffer.set(body, HEADER_BYTES);
  // Two trailing zeroes: the body terminator and the packet pad.
  buffer[total - 2] = 0;
  buffer[total - 1] = 0;
  return buffer;
}

export type RconDecodeResult = { packets: RconPacket[]; rest: Uint8Array };

/**
 * Pulls every complete packet out of a stream buffer.
 *
 * TCP hands over arbitrary slices, so a read may contain half a packet, three
 * packets, or a packet split across two reads. Returning the remainder lets the
 * caller keep the leftover bytes for the next read instead of losing them.
 */
export function decodeRconPackets(chunk: Uint8Array): RconDecodeResult {
  const packets: RconPacket[] = [];
  let offset = 0;

  while (chunk.byteLength - offset >= 4) {
    const view = new DataView(chunk.buffer, chunk.byteOffset + offset, chunk.byteLength - offset);
    const length = view.getInt32(0, true);
    if (length < 8 || length > MAX_PACKET_BYTES) {
      throw new RangeError("RCON paketi geçersiz uzunluk bildirdi.");
    }
    if (chunk.byteLength - offset < length + 4) break;

    const id = view.getInt32(4, true);
    const type = view.getInt32(8, true);
    const bodyBytes = chunk.subarray(offset + HEADER_BYTES, offset + 4 + length - 2);
    packets.push({ id, type, body: new TextDecoder().decode(bodyBytes) });
    offset += length + 4;
  }

  return { packets, rest: chunk.subarray(offset) };
}
