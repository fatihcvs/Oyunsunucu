import {
  AuthHttpError,
  assertMutationRequest,
  errorResponse,
  parseEmailAuthStartRequest,
} from "../../../../../lib/auth-http.ts";
import {
  getAuthRuntimeReadiness,
  type AuthEnvironment,
} from "../../../../../lib/auth-runtime.ts";

export const dynamic = "force-dynamic";

export async function handleEmailAuthStart(request: Request, environment: AuthEnvironment) {
  try {
    assertMutationRequest(request, environment.APP_ORIGIN);
    const runtime = getAuthRuntimeReadiness(environment);
    if (!runtime.checks.magicLink) {
      throw new AuthHttpError(
        503,
        "AUTH_NOT_CONFIGURED",
        "Canlı e-posta girişi henüz etkin değil.",
      );
    }

    await parseEmailAuthStartRequest(request);
    throw new AuthHttpError(
      503,
      "AUTH_ADAPTER_NOT_BOUND",
      "Kimlik deposu bağlantısı yayın ortamında henüz etkin değil.",
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export function POST(request: Request) {
  return handleEmailAuthStart(request, process.env);
}
