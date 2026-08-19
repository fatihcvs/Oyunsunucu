import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluatePlanChange,
  resolveRelativePlan,
  upgradeOptions,
} from "../lib/plan-change.ts";
import { getPlan } from "../lib/catalog.ts";

const MINECRAFT = { gameId: "minecraft", softwareId: "paper", regionId: "eu-west" };

test("an upgrade reports the real catalogue difference, not a guess", () => {
  const check = evaluatePlanChange({ ...MINECRAFT, fromPlanId: "mini-2", toPlanId: "starter-4" });
  assert.equal(check.ok, true);

  const mini = getPlan("mini-2");
  const starter = getPlan("starter-4");
  assert.equal(check.change.monthlyBefore, mini.price);
  assert.equal(check.change.monthlyAfter, starter.price);
  assert.equal(check.change.monthlyDifference, starter.price - mini.price);
});

test("a downgrade is refused, because the disk cannot shrink under a live world", () => {
  const check = evaluatePlanChange({ ...MINECRAFT, fromPlanId: "performance-6", toPlanId: "mini-2" });
  assert.equal(check.ok, false);
  assert.equal(check.code, "DOWNGRADE_UNSUPPORTED");
});

test("moving to the same plan is refused rather than queued as a no-op restart", () => {
  const check = evaluatePlanChange({ ...MINECRAFT, fromPlanId: "mini-2", toPlanId: "mini-2" });
  assert.equal(check.ok, false);
  assert.equal(check.code, "PLAN_UNCHANGED");
});

test("an unknown plan or unresolved runtime never produces a price", () => {
  const unknownPlan = evaluatePlanChange({ ...MINECRAFT, fromPlanId: "mini-2", toPlanId: "yok-boyle" });
  assert.equal(unknownPlan.ok, false);
  assert.equal(unknownPlan.code, "UNKNOWN_PLAN");

  const unresolved = evaluatePlanChange({
    fromPlanId: "mini-2",
    toPlanId: "starter-4",
    regionId: "eu-west",
    gameId: "fivem",
    softwareId: "vanilla",
  });
  assert.equal(unresolved.ok, false);
  assert.equal(unresolved.code, "RUNTIME_UNRESOLVED");
});

test("the upgrade list only contains plans the server may actually move to", () => {
  const options = upgradeOptions({ ...MINECRAFT, fromPlanId: "performance-6" });
  const ids = options.map((option) => option.planId);

  assert.equal(ids.includes("performance-6"), false, "aynı paket listelenmemeli");
  assert.equal(ids.includes("mini-2"), false, "küçültme listelenmemeli");
  assert.deepEqual(ids, ["community-8", "pro-12"]);
  for (const option of options) assert.ok(option.monthlyDifference > 0);
});

test("a relative phrase resolves to the smallest plan that is big enough", () => {
  // 2 GB doubled is 4 GB, which is exactly a catalogue entry.
  assert.equal(resolveRelativePlan("mini-2", 2).id, "starter-4");
  // 4 GB doubled is 8 GB; 6 GB is too small, so it lands on the 8 GB plan.
  assert.equal(resolveRelativePlan("starter-4", 2).id, "community-8");
  // 1.5x of 4 GB is 6 GB, an exact entry again.
  assert.equal(resolveRelativePlan("starter-4", 1.5).id, "performance-6");
  // Nothing in the catalogue is four times the largest plan.
  assert.equal(resolveRelativePlan("pro-12", 4), null);
  assert.equal(resolveRelativePlan("mini-2", 0), null);
});
