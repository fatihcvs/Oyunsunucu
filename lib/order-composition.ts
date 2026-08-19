import { createFakePaymentProvider } from "../infra/payments/fake-provider.ts";
import { createAuthRepository } from "../infra/postgres/driver-binding.ts";
import { PostgresOrderRepository } from "../infra/postgres/order-repository.ts";
import { createSqlExecutor } from "../infra/postgres/driver-binding.ts";
import { resolveAuthService, type AuthCompositionOverrides } from "./auth-composition.ts";
import type { AuthEnvironment } from "./auth-runtime.ts";
import { createOrderService, type OrderService } from "./order-service.ts";
import type { PaymentProvider } from "../infra/payments/provider.ts";

export type OrderCompositionOverrides = AuthCompositionOverrides & {
  orderService?: OrderService;
  provider?: PaymentProvider | null;
};

export type OrderResolution =
  | { status: "not_configured"; missing: string[] }
  | { status: "adapter_not_bound" }
  | { status: "ready"; service: OrderService };

/**
 * Which payment provider is live.
 *
 * Only the fake provider exists today, and it is opt-in: without
 * `PAYMENT_PROVIDER=fake` and a webhook secret the store cannot take an order
 * at all. That keeps a half-configured deployment from looking like a shop.
 */
export function createPaymentProvider(environment: AuthEnvironment): PaymentProvider | null {
  const secret = environment.PAYMENT_WEBHOOK_SECRET?.trim() ?? "";
  const appOrigin = environment.APP_ORIGIN?.trim() ?? "";
  if (environment.PAYMENT_PROVIDER?.trim() !== "fake" || secret.length < 32 || !appOrigin) return null;

  return createFakePaymentProvider({
    webhookSecret: secret,
    checkoutBaseUrl: new URL("/odeme/sahte", appOrigin).href,
  });
}

export function resolveOrderService(
  environment: AuthEnvironment,
  overrides: OrderCompositionOverrides = {},
): OrderResolution {
  if (overrides.orderService) return { status: "ready", service: overrides.orderService };

  const auth = resolveAuthService(environment, overrides);
  if (auth.status !== "ready") {
    return auth.status === "not_configured"
      ? { status: "not_configured", missing: auth.missing }
      : { status: "adapter_not_bound" };
  }

  const provider = "provider" in overrides ? overrides.provider : createPaymentProvider(environment);
  if (!provider) return { status: "not_configured", missing: ["PAYMENT_PROVIDER", "PAYMENT_WEBHOOK_SECRET"] };

  const repository = "repository" in overrides
    ? overrides.repository
    : createAuthRepository(environment);
  const executor = createSqlExecutor(environment);
  if (!repository || !executor) return { status: "adapter_not_bound" };

  return {
    status: "ready",
    service: createOrderService({
      auth: auth.service,
      orders: new PostgresOrderRepository(executor),
      provider,
      appOrigin: String(environment.APP_ORIGIN),
      onOperationalError: overrides.onOperationalError,
    }),
  };
}
