import {
  canTransition,
  type OrderStatus,
  type PriceSnapshot,
} from "../../lib/order-contracts.ts";
import type { SqlExecutor, TransactionalSqlExecutor } from "./auth-repository.ts";

export type OrderRecord = {
  orderId: string;
  ownerUserId: string;
  status: OrderStatus;
  totalMinor: number;
  subtotalMinor: number;
  vatMinor: number;
  catalogVersion: string;
};

export type RecordPaymentEventInput = {
  provider: string;
  providerEventId: string;
  eventType: string;
  providerPaymentId: string;
  orderId: string;
  amountMinor: number;
  paymentStatus: "pending" | "succeeded" | "failed" | "refunded";
  payload: Record<string, unknown>;
  now: Date;
};

export type PaymentEventOutcome = {
  /** False when this delivery was already handled; the caller must not act again. */
  applied: boolean;
  orderStatus: OrderStatus;
  paymentId: string | null;
};

export class OrderTransitionError extends Error {
  readonly status = 409;
  readonly code = "ORDER_TRANSITION_REJECTED";

  constructor(from: OrderStatus, to: OrderStatus) {
    super(`Sipariş durumu ${from} → ${to} geçişine izin vermiyor.`);
    this.name = "OrderTransitionError";
  }
}

export class PaymentAmountMismatchError extends Error {
  readonly status = 409;
  readonly code = "PAYMENT_AMOUNT_MISMATCH";

  constructor() {
    super("Ödeme tutarı sipariş toplamıyla eşleşmiyor.");
    this.name = "PaymentAmountMismatchError";
  }
}

function requiredText(value: unknown, field: string) {
  if (typeof value !== "string" || !value) throw new TypeError(`Veritabanı ${field} alanını döndürmedi.`);
  return value;
}

function requiredInteger(value: unknown, field: string) {
  const parsed = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new TypeError(`Veritabanı ${field} alanını sayı olarak döndürmedi.`);
  return parsed;
}

function toOrderRecord(row: Record<string, unknown>): OrderRecord {
  return {
    orderId: requiredText(row.id, "orders.id"),
    ownerUserId: requiredText(row.owner_user_id, "orders.owner_user_id"),
    status: requiredText(row.status, "orders.status") as OrderStatus,
    totalMinor: requiredInteger(row.total_minor, "orders.total_minor"),
    subtotalMinor: requiredInteger(row.subtotal_minor, "orders.subtotal_minor"),
    vatMinor: requiredInteger(row.vat_minor, "orders.vat_minor"),
    catalogVersion: requiredText(row.catalog_version, "orders.catalog_version"),
  };
}

export class PostgresOrderRepository {
  private readonly database: TransactionalSqlExecutor;

  constructor(database: TransactionalSqlExecutor) {
    this.database = database;
  }

  /**
   * Opens an order against a frozen price.
   *
   * The snapshot is written in the same transaction as the order, so an order
   * can never exist without the prices the customer was shown.
   */
  async createOrder(input: {
    ownerUserId: string;
    serverDraftId: string | null;
    snapshot: PriceSnapshot;
    now: Date;
  }): Promise<OrderRecord> {
    return this.database.transaction(async (transaction) => {
      const created = await transaction.query<Record<string, unknown>>(
        `INSERT INTO orders
           (owner_user_id, server_draft_id, status, currency, total_minor, subtotal_minor, vat_minor, catalog_version, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, 'draft', $3, $4, $5, $6, $7, $8, $8)
         RETURNING id::text AS id, owner_user_id::text AS owner_user_id, status,
                   total_minor, subtotal_minor, vat_minor, catalog_version`,
        [
          input.ownerUserId,
          input.serverDraftId,
          input.snapshot.currency,
          input.snapshot.totalMinor,
          input.snapshot.subtotalMinor,
          input.snapshot.vatMinor,
          input.snapshot.catalogVersion,
          input.now,
        ],
      );
      const order = toOrderRecord(created.rows[0] ?? {});

      for (const item of input.snapshot.lineItems) {
        await transaction.query(
          `INSERT INTO order_items (order_id, code, label, quantity, unit_amount_minor, amount_minor)
           VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
          [order.orderId, item.code, item.label, item.quantity, item.unitAmountMinor, item.amountMinor],
        );
      }

      await transaction.query(
        `INSERT INTO price_snapshots (order_id, catalog_version, specification, captured_at)
         VALUES ($1::uuid, $2, $3::jsonb, $4)`,
        [order.orderId, input.snapshot.catalogVersion, JSON.stringify(input.snapshot), input.now],
      );

      await transaction.query(
        `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata, occurred_at)
         VALUES ($1::uuid, 'order.created', 'order', $2, jsonb_build_object('total_minor', $3::bigint), $4)`,
        [input.ownerUserId, order.orderId, input.snapshot.totalMinor, input.now],
      );

      return order;
    });
  }

  async findOrder(orderId: string): Promise<OrderRecord | null> {
    const result = await this.database.query<Record<string, unknown>>(
      `SELECT id::text AS id, owner_user_id::text AS owner_user_id, status,
              total_minor, subtotal_minor, vat_minor, catalog_version
         FROM orders WHERE id = $1::uuid`,
      [orderId],
    );
    return result.rows[0] ? toOrderRecord(result.rows[0]) : null;
  }

  /** Rejects a transition the state machine does not allow, rather than storing it. */
  async transitionOrder(input: {
    orderId: string;
    expectedFrom: OrderStatus;
    to: OrderStatus;
    now: Date;
    actorUserId?: string | null;
  }) {
    if (!canTransition(input.expectedFrom, input.to)) {
      throw new OrderTransitionError(input.expectedFrom, input.to);
    }

    return this.database.transaction(async (transaction) => {
      const updated = await transaction.query<Record<string, unknown>>(
        `UPDATE orders
            SET status = $3, updated_at = $4
          WHERE id = $1::uuid AND status = $2
          RETURNING id::text AS id, owner_user_id::text AS owner_user_id, status,
                    total_minor, subtotal_minor, vat_minor, catalog_version`,
        [input.orderId, input.expectedFrom, input.to, input.now],
      );
      if (updated.rows.length !== 1) return null;

      await transaction.query(
        `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata, occurred_at)
         VALUES ($1::uuid, 'order.transitioned', 'order', $2,
                 jsonb_build_object('from', $3::text, 'to', $4::text), $5)`,
        [input.actorUserId ?? null, input.orderId, input.expectedFrom, input.to, input.now],
      );

      return toOrderRecord(updated.rows[0]);
    });
  }

  /**
   * Applies one provider webhook, exactly once.
   *
   * The provider's event id is the idempotency key: a redelivery inserts
   * nothing and reports `applied: false`, so a repeated "payment succeeded"
   * cannot move an order forward twice or provision a second server.
   *
   * The amount is checked against the frozen order total, so a payment for a
   * different sum is refused rather than quietly accepted.
   */
  async recordPaymentEvent(input: RecordPaymentEventInput): Promise<PaymentEventOutcome> {
    return this.database.transaction(async (transaction) => {
      const claimed = await transaction.query<{ id: unknown }>(
        `INSERT INTO payment_events (provider, provider_event_id, event_type, payload, received_at)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT (provider, provider_event_id) DO NOTHING
         RETURNING id::text AS id`,
        [input.provider, input.providerEventId, input.eventType, JSON.stringify(input.payload), input.now],
      );

      const order = await transaction.query<Record<string, unknown>>(
        `SELECT id::text AS id, owner_user_id::text AS owner_user_id, status,
                total_minor, subtotal_minor, vat_minor, catalog_version
           FROM orders WHERE id = $1::uuid FOR UPDATE`,
        [input.orderId],
      );
      if (order.rows.length !== 1) throw new TypeError("Ödeme olayı bilinmeyen bir siparişe ait.");
      const current = toOrderRecord(order.rows[0]);

      // A redelivery: the order keeps whatever state the first delivery left.
      if (claimed.rows.length === 0) {
        return { applied: false, orderStatus: current.status, paymentId: null };
      }
      const eventId = requiredText(claimed.rows[0].id, "payment_events.id");

      if (input.paymentStatus === "succeeded" && input.amountMinor !== current.totalMinor) {
        throw new PaymentAmountMismatchError();
      }

      const payment = await transaction.query<{ id: unknown }>(
        `INSERT INTO payments (order_id, provider, provider_payment_id, status, amount_minor, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $6)
         ON CONFLICT (provider, provider_payment_id) DO UPDATE SET
           status = EXCLUDED.status,
           updated_at = EXCLUDED.updated_at
         RETURNING id::text AS id`,
        [
          input.orderId,
          input.provider,
          input.providerPaymentId,
          input.paymentStatus,
          input.amountMinor,
          input.now,
        ],
      );
      const paymentId = requiredText(payment.rows[0]?.id, "payments.id");

      const target = input.paymentStatus === "succeeded"
        ? "paid"
        : input.paymentStatus === "failed" ? "failed" : null;

      let status = current.status;
      if (target && canTransition(current.status, target as OrderStatus)) {
        const moved = await transaction.query<{ status: unknown }>(
          `UPDATE orders SET status = $2, updated_at = $3
            WHERE id = $1::uuid AND status = $4
            RETURNING status`,
          [input.orderId, target, input.now, current.status],
        );
        if (moved.rows.length === 1) status = requiredText(moved.rows[0].status, "orders.status") as OrderStatus;
      }

      await transaction.query(
        `UPDATE payment_events SET payment_id = $2::uuid, processed_at = $3 WHERE id = $1::uuid`,
        [eventId, paymentId, input.now],
      );

      await transaction.query(
        `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata, occurred_at)
         VALUES ($1::uuid, 'order.payment_event', 'order', $2,
                 jsonb_build_object('event_type', $3::text, 'status', $4::text), $5)`,
        [current.ownerUserId, input.orderId, input.eventType, input.paymentStatus, input.now],
      );

      return { applied: true, orderStatus: status, paymentId };
    });
  }

  /** The frozen snapshot, exactly as captured. Never recomputed from the catalog. */
  async readPriceSnapshot(orderId: string): Promise<PriceSnapshot | null> {
    const result = await this.database.query<{ specification: unknown }>(
      "SELECT specification FROM price_snapshots WHERE order_id = $1::uuid",
      [orderId],
    );
    const specification = result.rows[0]?.specification;
    if (!specification) return null;

    return typeof specification === "string"
      ? JSON.parse(specification) as PriceSnapshot
      : specification as PriceSnapshot;
  }

  async listOrderItems(orderId: string) {
    const result = await this.database.query<Record<string, unknown>>(
      `SELECT code, label, quantity, unit_amount_minor, amount_minor
         FROM order_items WHERE order_id = $1::uuid ORDER BY code`,
      [orderId],
    );

    return result.rows.map((row) => ({
      code: requiredText(row.code, "order_items.code"),
      label: requiredText(row.label, "order_items.label"),
      quantity: requiredInteger(row.quantity, "order_items.quantity"),
      unitAmountMinor: requiredInteger(row.unit_amount_minor, "order_items.unit_amount_minor"),
      amountMinor: requiredInteger(row.amount_minor, "order_items.amount_minor"),
    }));
  }
}

export type OrderRepository = PostgresOrderRepository;
export type { SqlExecutor };
