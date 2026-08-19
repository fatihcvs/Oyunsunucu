import { HOSTING_REGIONS, getPlan } from "./catalog.ts";

/**
 * How much a region is allowed to hold.
 *
 * These are our own operating limits, not a provider's physical ceiling:
 * Railway will happily run more than we can afford. Capacity is therefore a
 * cost decision written down as a number, which is why it lives beside the
 * catalogue and not in an environment variable nobody reviews.
 */
export type RegionCapacity = {
  regionId: string;
  /** Total plan memory the region may commit, in gigabytes. */
  memoryGb: number;
  /** A ceiling on count as well, because many tiny servers still cost per service. */
  maxServers: number;
};

export const REGION_CAPACITY: readonly RegionCapacity[] = [
  { regionId: "eu-west", memoryGb: 64, maxServers: 20 },
];

export type CapacityUsage = {
  regionId: string;
  servers: number;
  /** Plan memory already committed, not memory currently in use. */
  reservedMemoryGb: number;
};

export type RegionCapacityView = RegionCapacity & {
  usedServers: number;
  usedMemoryGb: number;
  freeMemoryGb: number;
  /** 0 to 1, on whichever of the two limits is tighter. */
  utilisation: number;
};

/**
 * Capacity is counted against what plans promise, not what servers use today.
 *
 * A customer on a 4 GB plan may sit at 1 GB all week and still be entitled to
 * four. Planning against measured usage would oversell exactly the resource we
 * promised, and the bill arrives the moment everyone uses it at once.
 */
export function reservedMemoryGb(planIds: readonly string[]): number {
  return planIds.reduce((total, planId) => total + getPlan(planId).ram, 0);
}

export function describeCapacity(
  usage: readonly CapacityUsage[],
  capacity: readonly RegionCapacity[] = REGION_CAPACITY,
): RegionCapacityView[] {
  return capacity.map((region) => {
    const used = usage.find((entry) => entry.regionId === region.regionId);
    const usedServers = used?.servers ?? 0;
    const usedMemoryGb = used?.reservedMemoryGb ?? 0;

    return {
      ...region,
      usedServers,
      usedMemoryGb,
      freeMemoryGb: Math.max(0, region.memoryGb - usedMemoryGb),
      utilisation: Math.min(1, Math.max(
        region.memoryGb > 0 ? usedMemoryGb / region.memoryGb : 0,
        region.maxServers > 0 ? usedServers / region.maxServers : 0,
      )),
    };
  });
}

export type PlacementDecision =
  | { ok: true; regionId: string; freeMemoryGbAfter: number }
  | { ok: false; code: "REGION_UNKNOWN" | "REGION_FULL" | "NO_REGION_AVAILABLE"; message: string };

/** Whether one specific region can take a server of this size. */
export function canPlaceInRegion(input: {
  regionId: string;
  planId: string;
  usage: readonly CapacityUsage[];
  capacity?: readonly RegionCapacity[];
}): PlacementDecision {
  const capacity = input.capacity ?? REGION_CAPACITY;
  const region = capacity.find((entry) => entry.regionId === input.regionId);
  if (!region) {
    return { ok: false, code: "REGION_UNKNOWN", message: "Bu bölge için kapasite tanımlı değil." };
  }

  const [view] = describeCapacity(input.usage, [region]);
  const wanted = getPlan(input.planId).ram;
  if (view.usedServers >= region.maxServers || view.freeMemoryGb < wanted) {
    return {
      ok: false,
      code: "REGION_FULL",
      message: `${input.regionId} bölgesi dolu: ${view.usedServers}/${region.maxServers} sunucu, ${view.freeMemoryGb} GB boş.`,
    };
  }

  return { ok: true, regionId: region.regionId, freeMemoryGbAfter: view.freeMemoryGb - wanted };
}

/**
 * Picks where a new server should go.
 *
 * The emptiest region that fits, so load spreads instead of piling onto
 * whichever region happens to be first in the list. A pure function on purpose:
 * placement is the decision most worth testing and least worth discovering
 * through a provider call.
 */
export function choosePlacement(input: {
  planId: string;
  usage: readonly CapacityUsage[];
  capacity?: readonly RegionCapacity[];
  /** Restricts the choice, e.g. to what the customer asked for. */
  preferredRegionId?: string;
}): PlacementDecision {
  const capacity = input.capacity ?? REGION_CAPACITY;
  const candidates = input.preferredRegionId
    ? capacity.filter((region) => region.regionId === input.preferredRegionId)
    : capacity;

  if (candidates.length === 0) {
    return { ok: false, code: "REGION_UNKNOWN", message: "Bu bölge için kapasite tanımlı değil." };
  }

  const viable = candidates
    .map((region) => canPlaceInRegion({ regionId: region.regionId, planId: input.planId, usage: input.usage, capacity }))
    .filter((decision): decision is Extract<PlacementDecision, { ok: true }> => decision.ok)
    .sort((left, right) => right.freeMemoryGbAfter - left.freeMemoryGbAfter);

  if (viable.length > 0) return viable[0];

  return input.preferredRegionId
    ? canPlaceInRegion({
      regionId: input.preferredRegionId,
      planId: input.planId,
      usage: input.usage,
      capacity,
    })
    : { ok: false, code: "NO_REGION_AVAILABLE", message: "Şu anda uygun kapasitesi olan bölge yok." };
}

/** Every region the catalogue sells, so a missing capacity entry is visible. */
export function regionsWithoutCapacity(capacity: readonly RegionCapacity[] = REGION_CAPACITY) {
  return HOSTING_REGIONS
    .filter((region) => !capacity.some((entry) => entry.regionId === region.id))
    .map((region) => region.id);
}
