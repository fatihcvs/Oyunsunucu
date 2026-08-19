import { AuthHttpError, jsonNoStore } from "../../../../lib/auth-http.ts";
import type { AuthEnvironment } from "../../../../lib/auth-runtime.ts";
import { orderErrorResponse } from "../../../../lib/order-http.ts";
import {
  resolveOrderService,
  type OrderCompositionOverrides,
} from "../../../../lib/order-composition.ts";

export const dynamic = "force-dynamic";

/** A signed body larger than this is not a payment notification. */
export const WEBHOOK_MAX_BYTES = 64 * 1024;

/**
 * Receives payment notifications from the provider.
 *
 * There is no origin check and no session here on purpose: the caller is a
 * server, not a browser. The signature over the raw body is what authenticates
 * the delivery, so the body is read as text and never re-serialised — parsing
 * and re-encoding JSON would change the bytes the signature covers.
 *
 * A redelivery is answered `200` with `applied: false`. Providers retry on any
 * non-2xx, and a repeated event is not an error.
 */
export async function handlePaymentWebhook(
  request: Request,
  environment: AuthEnvironment,
  overrides: OrderCompositionOverrides = {},
) {
  try {
    const resolution = resolveOrderService(environment, overrides);
    if (resolution.status !== "ready") {
      throw new AuthHttpError(503, "ORDERS_NOT_CONFIGURED", "Ödeme bildirimi alma henüz etkin değil.");
    }

    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > WEBHOOK_MAX_BYTES) {
      throw new AuthHttpError(413, "REQUEST_TOO_LARGE", "Bildirim gövdesi çok büyük.");
    }

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > WEBHOOK_MAX_BYTES) {
      throw new AuthHttpError(413, "REQUEST_TOO_LARGE", "Bildirim gövdesi çok büyük.");
    }

    const outcome = await resolution.service.applyWebhook({
      rawBody,
      signature: request.headers.get("x-riftory-signature"),
      timestamp: request.headers.get("x-riftory-timestamp"),
    });

    return jsonNoStore({
      code: outcome.applied ? "EVENT_APPLIED" : "EVENT_ALREADY_APPLIED",
      orderStatus: outcome.orderStatus,
    });
  } catch (error) {
    return orderErrorResponse(error);
  }
}

export function POST(request: Request) {
  return handlePaymentWebhook(request, process.env);
}
