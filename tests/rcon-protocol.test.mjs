import assert from "node:assert/strict";
import test from "node:test";
import {
  RCON_PACKET,
  decodeRconPackets,
  encodeRconPacket,
} from "../infra/gameservers/rcon-protocol.ts";

test("a packet round-trips through encode and decode unchanged", () => {
  const packet = { id: 7, type: RCON_PACKET.command, body: "list" };
  const { packets, rest } = decodeRconPackets(encodeRconPacket(packet));

  assert.deepEqual(packets, [packet]);
  assert.equal(rest.byteLength, 0);
});

test("the length field counts everything after itself", () => {
  const encoded = encodeRconPacket({ id: 1, type: RCON_PACKET.auth, body: "sifre" });
  const declared = new DataView(encoded.buffer).getInt32(0, true);

  assert.equal(declared, encoded.byteLength - 4);
  // Two trailing zeroes: body terminator and packet pad.
  assert.equal(encoded[encoded.byteLength - 1], 0);
  assert.equal(encoded[encoded.byteLength - 2], 0);
});

test("several packets in one read are all returned", () => {
  const first = encodeRconPacket({ id: 1, type: RCON_PACKET.response, body: "bir" });
  const second = encodeRconPacket({ id: 2, type: RCON_PACKET.response, body: "iki" });
  const joined = new Uint8Array(first.byteLength + second.byteLength);
  joined.set(first, 0);
  joined.set(second, first.byteLength);

  const { packets, rest } = decodeRconPackets(joined);
  assert.deepEqual(packets.map((packet) => packet.body), ["bir", "iki"]);
  assert.equal(rest.byteLength, 0);
});

test("a packet split across reads is held back until it is complete", () => {
  const whole = encodeRconPacket({ id: 3, type: RCON_PACKET.response, body: "bölünmüş yanıt" });
  const half = whole.subarray(0, 9);

  const first = decodeRconPackets(half);
  assert.deepEqual(first.packets, []);
  assert.equal(first.rest.byteLength, half.byteLength);

  const { packets } = decodeRconPackets(whole);
  assert.equal(packets[0].body, "bölünmüş yanıt");
});

test("a nonsense length is refused instead of allocating on it", () => {
  const hostile = new Uint8Array(12);
  new DataView(hostile.buffer).setInt32(0, 2_000_000_000, true);
  assert.throws(() => decodeRconPackets(hostile), RangeError);

  const tooSmall = new Uint8Array(12);
  new DataView(tooSmall.buffer).setInt32(0, 2, true);
  assert.throws(() => decodeRconPackets(tooSmall), RangeError);
});

test("multi-byte characters survive the round trip", () => {
  const body = "Oyuncu çağrıldı: şükrü — ölçüm";
  const { packets } = decodeRconPackets(encodeRconPacket({ id: 9, type: RCON_PACKET.response, body }));
  assert.equal(packets[0].body, body);
});
