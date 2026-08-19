import assert from "node:assert/strict";
import test from "node:test";
import {
  REGION_CAPACITY,
  canPlaceInRegion,
  choosePlacement,
  describeCapacity,
  regionsWithoutCapacity,
  reservedMemoryGb,
} from "../lib/capacity.ts";

const TWO_REGIONS = [
  { regionId: "eu-west", memoryGb: 16, maxServers: 4 },
  { regionId: "tr-central", memoryGb: 16, maxServers: 4 },
];

test("reserved memory counts what plans promise, not what servers use", () => {
  // mini-2 is 2 GB and starter-4 is 4 GB, whatever they happen to consume today.
  assert.equal(reservedMemoryGb(["mini-2", "mini-2", "starter-4"]), 8);
  assert.equal(reservedMemoryGb([]), 0);
});

test("utilisation follows whichever limit is tighter", () => {
  const [byMemory] = describeCapacity(
    [{ regionId: "eu-west", servers: 1, reservedMemoryGb: 12 }],
    [{ regionId: "eu-west", memoryGb: 16, maxServers: 8 }],
  );
  assert.equal(byMemory.utilisation, 0.75);
  assert.equal(byMemory.freeMemoryGb, 4);

  // Many small servers can exhaust the count long before the memory.
  const [byCount] = describeCapacity(
    [{ regionId: "eu-west", servers: 7, reservedMemoryGb: 14 }],
    [{ regionId: "eu-west", memoryGb: 64, maxServers: 8 }],
  );
  assert.equal(byCount.utilisation, 0.875);
});

test("a region refuses a server it cannot hold, by memory or by count", () => {
  const tooBig = canPlaceInRegion({
    regionId: "eu-west",
    planId: "pro-12",
    usage: [{ regionId: "eu-west", servers: 1, reservedMemoryGb: 8 }],
    capacity: TWO_REGIONS,
  });
  assert.equal(tooBig.ok, false);
  assert.equal(tooBig.code, "REGION_FULL");

  const tooMany = canPlaceInRegion({
    regionId: "eu-west",
    planId: "mini-2",
    usage: [{ regionId: "eu-west", servers: 4, reservedMemoryGb: 8 }],
    capacity: TWO_REGIONS,
  });
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.code, "REGION_FULL");

  const fits = canPlaceInRegion({
    regionId: "eu-west",
    planId: "mini-2",
    usage: [{ regionId: "eu-west", servers: 1, reservedMemoryGb: 2 }],
    capacity: TWO_REGIONS,
  });
  assert.equal(fits.ok, true);
  assert.equal(fits.freeMemoryGbAfter, 12);
});

test("placement spreads load onto the emptiest region that fits", () => {
  const decision = choosePlacement({
    planId: "starter-4",
    usage: [
      { regionId: "eu-west", servers: 3, reservedMemoryGb: 12 },
      { regionId: "tr-central", servers: 1, reservedMemoryGb: 2 },
    ],
    capacity: TWO_REGIONS,
  });

  assert.equal(decision.ok, true);
  assert.equal(decision.regionId, "tr-central", "daha boş bölge seçilmeli");
});

test("a requested region is honoured, and its own refusal is the one reported", () => {
  const honoured = choosePlacement({
    planId: "mini-2",
    preferredRegionId: "eu-west",
    usage: [
      { regionId: "eu-west", servers: 1, reservedMemoryGb: 2 },
      { regionId: "tr-central", servers: 0, reservedMemoryGb: 0 },
    ],
    capacity: TWO_REGIONS,
  });
  assert.equal(honoured.regionId, "eu-west", "boş başka bölge varken bile istenen bölge kullanılmalı");

  // A full preferred region reports why it is full rather than silently moving
  // the customer somewhere they did not choose.
  const refused = choosePlacement({
    planId: "mini-2",
    preferredRegionId: "eu-west",
    usage: [
      { regionId: "eu-west", servers: 4, reservedMemoryGb: 8 },
      { regionId: "tr-central", servers: 0, reservedMemoryGb: 0 },
    ],
    capacity: TWO_REGIONS,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "REGION_FULL");
  assert.match(refused.message, /eu-west/);
});

test("with nowhere to put it, placement says so instead of picking anyway", () => {
  const decision = choosePlacement({
    planId: "pro-12",
    usage: [
      { regionId: "eu-west", servers: 4, reservedMemoryGb: 16 },
      { regionId: "tr-central", servers: 4, reservedMemoryGb: 16 },
    ],
    capacity: TWO_REGIONS,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.code, "NO_REGION_AVAILABLE");

  const unknown = choosePlacement({ planId: "mini-2", preferredRegionId: "mars", usage: [], capacity: TWO_REGIONS });
  assert.equal(unknown.code, "REGION_UNKNOWN");
});

test("every sellable region has a capacity entry", () => {
  assert.deepEqual(regionsWithoutCapacity(), [], "kapasitesi tanımsız bölge satılmamalı");
  assert.ok(REGION_CAPACITY.length > 0);
});
