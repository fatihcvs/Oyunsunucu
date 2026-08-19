import {
  AuthHttpError,
  assertMutationRequest,
  jsonNoStore,
} from "../../../lib/auth-http.ts";
import type { AuthEnvironment } from "../../../lib/auth-runtime.ts";
import { orderErrorResponse } from "../../../lib/order-http.ts";
import { readSessionToken } from "../../../lib/auth-session.ts";
import {
  resolveOrderService,
  type OrderCompositionOverrides,
} from "../../../lib/order-composition.ts";

export const dynamic = "force-dynamic";

function requireOrderService(environment: AuthEnvironment, overrides: OrderCompositionOverrides) {
  const resolution = resolveOrderService(environment, overrides);
  if (resolution.status === "not_configured") {
    throw new AuthHttpError(503, "ORDERS_NOT_CONFIGURED", "Sipariş alma henüz etkin değil.");
  }
  if (resolution.status === "adapter_not_bound") {
    throw new AuthHttpError(503, "AUTH_ADAPTER_NOT_BOUND", "Kimlik deposu bağlantısı henüz etkin değil.");
  }
  return resolution.service;
}

/**
 * Opens an order for the signed-in customer.
 *
 * The body carries the configuration only; the amount is priced from the
 * catalog on this side, so a client cannot choose what it pays.
 */
export async function handleCreateOrder(
  request: Request,
  environment: AuthEnvironment,
  overrides: OrderCompositionOverrides = {},
) {
  try {
    assertMutationRequest(request, environment.APP_ORIGIN);
    const service = requireOrderService(environment, overrides);

    const rawToken = readSessionToken(request);
    if (!rawToken) {
      throw new AuthHttpError(401, "SESSION_REQUIRED", "Bu işlem için giriş yapılmalıdır.");
    }

    const text = await request.text();
    let body: Record<string, unknown>;
    try {
      body = text.trim() ? JSON.parse(text) : {};
    } catch {
      throw new AuthHttpError(400, "INVALID_JSON", "Geçerli bir JSON gövdesi gönderin.");
    }

    const checkout = await service.startCheckout({
      rawToken,
      draft: body.draft,
      serverDraftId: typeof body.serverDraftId === "string" ? body.serverDraftId : null,
      returnTo: typeof body.returnTo === "string" ? body.returnTo : null,
    });

    return jsonNoStore(checkout, 201);
  } catch (error) {
    return orderErrorResponse(error);
  }
}

export function POST(request: Request) {
  return handleCreateOrder(request, process.env);
}
