import {
  clientIpAddress,
  assertMutationRequest,
  clientDiscriminator,
  errorResponse,
  jsonNoStore,
  parseEmailAuthStartRequest,
  requireLiveAuthService,
} from "../../../../../lib/auth-http.ts";
import {
  resolveAuthService,
  type AuthCompositionOverrides,
} from "../../../../../lib/auth-composition.ts";
import type { AuthEnvironment } from "../../../../../lib/auth-runtime.ts";

export const dynamic = "force-dynamic";

export async function handleEmailAuthStart(
  request: Request,
  environment: AuthEnvironment,
  overrides: AuthCompositionOverrides = {},
) {
  try {
    assertMutationRequest(request, environment.APP_ORIGIN);
    const service = requireLiveAuthService(
      resolveAuthService(environment, overrides),
      "Canlı e-posta girişi henüz etkin değil.",
    );
    const payload = await parseEmailAuthStartRequest(request);

    const result = await service.requestMagicLink({
      mode: payload.mode,
      email: payload.email,
      displayName: payload.displayName,
      returnTo: payload.returnTo,
      clientDiscriminator: clientDiscriminator(request),
      requestedIp: clientIpAddress(request),
    });

    return jsonNoStore({ code: result.code, message: result.message }, 202);
  } catch (error) {
    return errorResponse(error);
  }
}

export function POST(request: Request) {
  return handleEmailAuthStart(request, process.env);
}
