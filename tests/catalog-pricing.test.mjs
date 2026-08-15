import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKUP_MONTHLY_PRICE,
  DEFAULT_SERVER_DRAFT,
  HOSTING_PLANS,
  HOSTING_REGIONS,
  calculateMonthlyPrice,
  getPlan,
  isServerDraft,
} from "../lib/catalog.ts";

test("every plan keeps its catalog base price when backup is disabled", () => {
  for (const plan of HOSTING_PLANS) {
    const total = calculateMonthlyPrice({
      ...DEFAULT_SERVER_DRAFT,
      planId: plan.id,
      backups: false,
    });
    assert.equal(total, plan.price, plan.id);
  }
});

test("daily backup is added exactly once", () => {
  const withoutBackup = calculateMonthlyPrice({
    ...DEFAULT_SERVER_DRAFT,
    planId: "community-8",
    backups: false,
  });
  const withBackup = calculateMonthlyPrice({
    ...DEFAULT_SERVER_DRAFT,
    planId: "community-8",
    backups: true,
  });

  assert.equal(withoutBackup, 899);
  assert.equal(withBackup, 899 + BACKUP_MONTHLY_PRICE);
});

test("region surcharge is part of the single price calculation", () => {
  for (const region of HOSTING_REGIONS) {
    const plan = getPlan("starter-4");
    const total = calculateMonthlyPrice({
      planId: plan.id,
      regionId: region.id,
      backups: false,
    });
    assert.equal(total, plan.price + region.surcharge, region.id);
  }
});

test("stored drafts are rejected when catalog identifiers are invalid", () => {
  assert.equal(isServerDraft(DEFAULT_SERVER_DRAFT), true);
  assert.equal(isServerDraft({ ...DEFAULT_SERVER_DRAFT, planId: "invented-plan" }), false);
  assert.equal(isServerDraft({ ...DEFAULT_SERVER_DRAFT, gameId: "rust" }), false);
  assert.equal(isServerDraft({ ...DEFAULT_SERVER_DRAFT, backups: "yes" }), false);
});
