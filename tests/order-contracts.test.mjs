import assert from "node:assert/strict";
import test from "node:test";
import {
  VAT_RATE_BASIS_POINTS,
  canTransition,
  createPriceSnapshot,
  isTerminal,
  nextStatuses,
  splitVatInclusive,
  toMinor,
} from "../lib/order-contracts.ts";
import {
  BACKUP_MONTHLY_PRICE,
  CATALOG_VERSION,
  DEFAULT_SERVER_DRAFT,
  calculateMonthlyPrice,
  getPlan,
} from "../lib/catalog.ts";

test("the snapshot total matches the price the store displays", () => {
  for (const backups of [true, false]) {
    const draft = { ...DEFAULT_SERVER_DRAFT, backups };
    const snapshot = createPriceSnapshot(draft);

    // The configurator and the order must never disagree about the amount.
    assert.equal(snapshot.totalMinor, toMinor(calculateMonthlyPrice(draft)));
    assert.equal(
      snapshot.lineItems.reduce((sum, item) => sum + item.amountMinor, 0),
      snapshot.totalMinor,
    );
    assert.equal(snapshot.catalogVersion, CATALOG_VERSION);
  }
});

test("splits VAT out of the displayed total without losing a kuruş", () => {
  for (const totalMinor of [29_900, 49_900, 124_900, 1, 7, 99_999]) {
    const { subtotalMinor, vatMinor } = splitVatInclusive(totalMinor);
    assert.equal(subtotalMinor + vatMinor, totalMinor, `${totalMinor} bölünürken kuruş kayboldu`);
    assert.ok(vatMinor >= 0);
  }

  // 20% inclusive: 299,00 TL contains 49,83 TL tax.
  assert.equal(VAT_RATE_BASIS_POINTS, 2000);
  assert.deepEqual(splitVatInclusive(29_900), { subtotalMinor: 24_917, vatMinor: 4_983 });
});

test("prices the backup add-on exactly once", () => {
  const withBackup = createPriceSnapshot({ ...DEFAULT_SERVER_DRAFT, backups: true });
  const without = createPriceSnapshot({ ...DEFAULT_SERVER_DRAFT, backups: false });

  assert.equal(withBackup.totalMinor - without.totalMinor, toMinor(BACKUP_MONTHLY_PRICE));
  assert.equal(withBackup.lineItems.filter((item) => item.code === "backup:daily").length, 1);
  assert.equal(without.lineItems.some((item) => item.code === "backup:daily"), false);
});

test("refuses to price something the store does not sell", () => {
  assert.equal(createPriceSnapshot({ ...DEFAULT_SERVER_DRAFT, softwareId: "tmodloader", gameId: "terraria" }), null);
  assert.equal(createPriceSnapshot({ ...DEFAULT_SERVER_DRAFT, planId: "bilinmeyen" }), null);
  assert.equal(createPriceSnapshot({ ...DEFAULT_SERVER_DRAFT, gameId: "fivem" }), null);
  assert.equal(createPriceSnapshot(null), null);
  assert.equal(createPriceSnapshot({}), null);
});

test("records the plan the customer chose, not a default", () => {
  const draft = { ...DEFAULT_SERVER_DRAFT, planId: "pro-12", backups: false };
  const snapshot = createPriceSnapshot(draft);

  assert.equal(snapshot.totalMinor, toMinor(getPlan("pro-12").price));
  assert.deepEqual(snapshot.specification, draft);
  assert.match(snapshot.lineItems[0].code, /^plan:pro-12$/);
});

test("only allows the transitions the product actually supports", () => {
  assert.equal(canTransition("draft", "pending_payment"), true);
  assert.equal(canTransition("pending_payment", "paid"), true);
  assert.equal(canTransition("paid", "provisioning"), true);
  assert.equal(canTransition("provisioning", "active"), true);
  assert.equal(canTransition("failed", "pending_payment"), true);

  // A paid order must never fall back to awaiting payment.
  assert.equal(canTransition("paid", "pending_payment"), false);
  assert.equal(canTransition("draft", "paid"), false);
  assert.equal(canTransition("active", "provisioning"), false);
  assert.equal(canTransition("cancelled", "pending_payment"), false);
});

test("cancelled and refunded orders are terminal", () => {
  assert.equal(isTerminal("cancelled"), true);
  assert.equal(isTerminal("refunded"), true);
  assert.equal(isTerminal("draft"), false);
  assert.deepEqual(nextStatuses("cancelled"), []);
  assert.deepEqual(nextStatuses("pending_payment"), ["paid", "failed", "cancelled"]);
});
