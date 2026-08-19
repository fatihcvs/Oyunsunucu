import {
  AuthHttpError,
  assertMutationRequest,
  errorResponse,
  jsonNoStore,
  readJsonRecord,
} from "../../../../lib/auth-http.ts";
import type { AuthEnvironment } from "../../../../lib/auth-runtime.ts";
import { readSessionToken } from "../../../../lib/auth-session.ts";
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

export async function handleAdminPasswordChange(
  request: Request,
  environment: AuthEnvironment,
  overrides: AdminPasswordCompositionOverrides = {},
) {
  try {
    assertMutationRequest(request, environment.APP_ORIGIN);
    const resolution = resolveAdminPasswordService(environment, overrides);
    if (resolution.status === "not_configured") {
      throw new AuthHttpError(503, "ADMIN_PASSWORD_NOT_CONFIGURED", "Admin parola girişi henüz etkin değil.");
    }
    if (resolution.status === "adapter_not_bound") {
      throw new AuthHttpError(503, "ADMIN_ADAPTER_NOT_BOUND", "Admin kimlik deposu bağlantısı henüz etkin değil.");
    }

    const token = readSessionToken(request);
    if (!token) {
      throw new AdminPasswordFlowError(401, "SESSION_REQUIRED", "Bu işlem için giriş yapılmalıdır.");
    }
    const body = await readJsonRecord(request);
    return jsonNoStore(await resolution.service.changePassword({
      rawToken: token,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    }));
  } catch (error) {
    return adminPasswordErrorResponse(error);
  }
}

export function POST(request: Request) {
  return handleAdminPasswordChange(request, process.env);
}
