import {
  AuthHttpError,
  assertMutationRequest,
  clientDiscriminator,
  clientIpAddress,
  errorResponse,
  jsonNoStore,
  parseAdminPasswordSignInRequest,
  requestUserAgent,
} from "../../../../lib/auth-http.ts";
import { buildSessionCookie } from "../../../../lib/auth-security.ts";
import type { AuthEnvironment } from "../../../../lib/auth-runtime.ts";
import { AdminPasswordFlowError } from "../../../../lib/admin-password-service.ts";
import {
  resolveAdminPasswordService,
  type AdminPasswordCompositionOverrides,
} from "../../../../lib/admin-password-composition.ts";

export const dynamic = "force-dynamic";

function adminPasswordErrorResponse(error: unknown) {
  if (error instanceof AdminPasswordFlowError) {
    return jsonNoStore(
      { code: error.code, message: error.message },
      error.status,
      error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : {},
    );
  }
  return errorResponse(error);
}

function requireService(environment: AuthEnvironment, overrides: AdminPasswordCompositionOverrides) {
  const resolution = resolveAdminPasswordService(environment, overrides);
  if (resolution.status === "not_configured") {
    throw new AuthHttpError(503, "ADMIN_PASSWORD_NOT_CONFIGURED", "Admin parola girişi henüz etkin değil.");
  }
  if (resolution.status === "adapter_not_bound") {
    throw new AuthHttpError(503, "ADMIN_ADAPTER_NOT_BOUND", "Admin kimlik deposu bağlantısı henüz etkin değil.");
  }
  return resolution.service;
}

export async function handleAdminPasswordSignIn(
  request: Request,
  environment: AuthEnvironment,
  overrides: AdminPasswordCompositionOverrides = {},
) {
  try {
    assertMutationRequest(request, environment.APP_ORIGIN);
    const service = requireService(environment, overrides);
    const credentials = await parseAdminPasswordSignInRequest(request);
    const session = await service.signIn({
      ...credentials,
      clientDiscriminator: clientDiscriminator(request),
      ipAddress: clientIpAddress(request),
      userAgent: requestUserAgent(request),
    });
    return jsonNoStore(
      { authenticated: true, returnTo: "/admin" },
      200,
      { "Set-Cookie": buildSessionCookie(session.sessionToken) },
    );
  } catch (error) {
    return adminPasswordErrorResponse(error);
  }
}

export function POST(request: Request) {
  return handleAdminPasswordSignIn(request, process.env);
}
