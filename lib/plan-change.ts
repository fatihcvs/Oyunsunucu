import { HOSTING_PLANS, calculateMonthlyPrice, getPlan, getRegion, type HostingPlan } from "./catalog.ts";
import { findGameRuntime } from "../infra/gameservers/runtime-catalog.ts";

export type PlanChange = {
  from: HostingPlan;
  to: HostingPlan;
  /** Monthly catalogue difference in whole lira; positive when it costs more. */
  monthlyDifference: number;
  monthlyBefore: number;
  monthlyAfter: number;
};

export type PlanChangeCheck =
  | { ok: true; change: PlanChange }
  | { ok: false; code: string; message: string };

/**
 * Whether a server may move from one plan to another, and what it costs.
 *
 * Only upward moves are allowed for now, and the reason is concrete rather than
 * commercial: a smaller plan carries a smaller disk, and neither Railway
 * volumes nor a running world can be shrunk safely. Offering a downgrade we
 * cannot honour would be a promise the provider has no way to keep.
 */
export function evaluatePlanChange(input: {
  fromPlanId: string;
  toPlanId: string;
  regionId: string;
  gameId: string;
  softwareId: string;
  backups?: boolean;
}): PlanChangeCheck {
  const from = HOSTING_PLANS.find((plan) => plan.id === input.fromPlanId);
  const to = HOSTING_PLANS.find((plan) => plan.id === input.toPlanId);
  if (!from || !to) {
    return { ok: false, code: "UNKNOWN_PLAN", message: "Paket katalogda bulunamadı." };
  }
  if (from.id === to.id) {
    return { ok: false, code: "PLAN_UNCHANGED", message: "Sunucu zaten bu pakette." };
  }
  if (to.ram < from.ram || to.storage < from.storage) {
    return {
      ok: false,
      code: "DOWNGRADE_UNSUPPORTED",
      message: "Paket küçültme henüz yapılamıyor: disk küçültmek dünyayı riske atar.",
    };
  }

  const runtime = findGameRuntime(input.gameId, input.softwareId);
  if (!runtime?.image) {
    return { ok: false, code: "RUNTIME_UNRESOLVED", message: "Bu sunucunun çalışma ortamı çözülmemiş." };
  }
  if (to.ram * 1_024 < runtime.minimumMemoryMb) {
    return { ok: false, code: "PLAN_TOO_SMALL", message: "Seçilen paket bu çalışma ortamı için yetersiz." };
  }

  const backups = input.backups ?? false;
  const region = getRegion(input.regionId);
  const monthlyBefore = calculateMonthlyPrice({ planId: from.id, regionId: region.id, backups });
  const monthlyAfter = calculateMonthlyPrice({ planId: to.id, regionId: region.id, backups });

  return {
    ok: true,
    change: {
      from,
      to,
      monthlyBefore,
      monthlyAfter,
      monthlyDifference: monthlyAfter - monthlyBefore,
    },
  };
}

/**
 * The plans a server could move to, with what each would cost.
 *
 * Built for the panel and for the assistant: "take it to 2x" resolves to a real
 * catalogue entry here rather than being invented at the point of use.
 */
export function upgradeOptions(input: {
  fromPlanId: string;
  regionId: string;
  gameId: string;
  softwareId: string;
  backups?: boolean;
}) {
  return HOSTING_PLANS.flatMap((plan) => {
    const check = evaluatePlanChange({ ...input, toPlanId: plan.id });
    return check.ok
      ? [{
        planId: plan.id,
        label: plan.label,
        ramGb: plan.ram,
        storageGb: plan.storage,
        players: plan.players,
        monthlyAfter: check.change.monthlyAfter,
        monthlyDifference: check.change.monthlyDifference,
      }]
      : [];
  });
}

/**
 * The plan a relative phrase such as "2x" points at.
 *
 * Doubling rarely lands exactly on a catalogue entry, so it resolves to the
 * smallest plan that is at least the requested memory. Returning null when
 * nothing is large enough keeps the caller from silently picking the top plan.
 */
export function resolveRelativePlan(fromPlanId: string, multiplier: number) {
  const from = getPlan(fromPlanId);
  if (!Number.isFinite(multiplier) || multiplier <= 0) return null;

  const targetRam = from.ram * multiplier;
  const candidates = HOSTING_PLANS
    .filter((plan) => plan.ram >= targetRam)
    .sort((left, right) => left.ram - right.ram);
  return candidates[0] ?? null;
}

/** Region surcharge is part of the monthly price, so the panel can show it whole. */
export function regionSurcharge(regionId: string) {
  return getRegion(regionId).surcharge;
}
