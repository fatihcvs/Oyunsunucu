import {
  BACKUP_MONTHLY_PRICE,
  CATALOG_VERSION,
  getGame,
  getPlan,
  getRegion,
  isServerDraft,
  sellableSoftware,
  type ServerDraft,
} from "./catalog.ts";

/**
 * Turkish VAT, in basis points.
 *
 * Catalog prices are treated as **VAT inclusive**, which is how consumer prices
 * are shown in Turkey: the 299 TL on the page is what the customer pays, and
 * the tax is extracted from it for the invoice. If the business decides to
 * quote net prices instead, this file is the only place that changes.
 */
export const VAT_RATE_BASIS_POINTS = 2000;
export const CURRENCY = "TRY" as const;

export type OrderStatus =
  | "draft"
  | "pending_payment"
  | "paid"
  | "provisioning"
  | "active"
  | "failed"
  | "cancelled"
  | "refunded";

export type OrderLineItem = {
  code: string;
  label: string;
  quantity: number;
  unitAmountMinor: number;
  amountMinor: number;
};

export type PriceSnapshot = {
  catalogVersion: string;
  currency: typeof CURRENCY;
  lineItems: OrderLineItem[];
  subtotalMinor: number;
  vatMinor: number;
  totalMinor: number;
  specification: ServerDraft;
};

/**
 * Which transitions the product actually allows.
 *
 * Anything not listed is a bug rather than a state to handle: a paid order can
 * never fall back to `pending_payment`, and a refunded one is terminal.
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  draft: ["pending_payment", "cancelled"],
  pending_payment: ["paid", "failed", "cancelled"],
  // A failed payment may be retried; the order returns to awaiting payment.
  failed: ["pending_payment", "cancelled"],
  paid: ["provisioning", "refunded"],
  provisioning: ["active", "failed"],
  active: ["refunded"],
  cancelled: [],
  refunded: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus) {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextStatuses(from: OrderStatus) {
  return [...(ALLOWED_TRANSITIONS[from] ?? [])];
}

export function isTerminal(status: OrderStatus) {
  return ALLOWED_TRANSITIONS[status]?.length === 0;
}

export function toMinor(amount: number) {
  return Math.round(amount * 100);
}

export function formatMinor(amountMinor: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: CURRENCY,
    minimumFractionDigits: 2,
  }).format(amountMinor / 100);
}

/**
 * Splits a VAT-inclusive total into net and tax.
 *
 * The tax is derived from the total rather than added to a net figure, so the
 * two parts always add back up to the amount the customer was shown.
 */
export function splitVatInclusive(totalMinor: number) {
  const net = Math.round((totalMinor * 10_000) / (10_000 + VAT_RATE_BASIS_POINTS));
  return { subtotalMinor: net, vatMinor: totalMinor - net };
}

/**
 * Freezes what the customer is buying and what it costs.
 *
 * Returns null for a draft the store does not sell, so an order can never be
 * opened for a combination the configurator would refuse.
 */
export function createPriceSnapshot(draft: unknown): PriceSnapshot | null {
  if (!isServerDraft(draft)) return null;

  const game = getGame(draft.gameId);
  const software = sellableSoftware(game).find((item) => item.id === draft.softwareId);
  const plan = getPlan(draft.planId);
  const region = getRegion(draft.regionId);
  if (!software || plan.id !== draft.planId || region.id !== draft.regionId) return null;

  const lineItems: OrderLineItem[] = [{
    code: `plan:${plan.id}`,
    label: `${game.name} · ${software.name} · ${plan.label} (${plan.ram} GB)`,
    quantity: 1,
    unitAmountMinor: toMinor(plan.price),
    amountMinor: toMinor(plan.price),
  }];

  if (region.surcharge > 0) {
    lineItems.push({
      code: `region:${region.id}`,
      label: `${region.name} bölge farkı`,
      quantity: 1,
      unitAmountMinor: toMinor(region.surcharge),
      amountMinor: toMinor(region.surcharge),
    });
  }

  if (draft.backups) {
    lineItems.push({
      code: "backup:daily",
      label: "Günlük yedekleme",
      quantity: 1,
      unitAmountMinor: toMinor(BACKUP_MONTHLY_PRICE),
      amountMinor: toMinor(BACKUP_MONTHLY_PRICE),
    });
  }

  const totalMinor = lineItems.reduce((sum, item) => sum + item.amountMinor, 0);
  const { subtotalMinor, vatMinor } = splitVatInclusive(totalMinor);

  return {
    catalogVersion: CATALOG_VERSION,
    currency: CURRENCY,
    lineItems,
    subtotalMinor,
    vatMinor,
    totalMinor,
    specification: draft,
  };
}
