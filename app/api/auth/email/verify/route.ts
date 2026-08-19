import {
  clientIpAddress,
  assertMutationRequest,
  clientDiscriminator,
  errorResponse,
  jsonNoStore,
  parseMagicLinkTokenRequest,
  requestUserAgent,
  requireLiveAuthService,
} from "../../../../../lib/auth-http.ts";
import {
  resolveAuthService,
  type AuthCompositionOverrides,
} from "../../../../../lib/auth-composition.ts";
import type { AuthEnvironment } from "../../../../../lib/auth-runtime.ts";
import { buildSessionCookie } from "../../../../../lib/auth-security.ts";

export const dynamic = "force-dynamic";

/**
 * Consumes a one-time link only on an explicit same-origin POST, so link
 * scanners and prefetching mail clients cannot burn a user's login.
 */
export async function handleEmailAuthVerify(
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
    const token = await parseMagicLinkTokenRequest(request);

    const session = await service.consumeMagicLink({
      rawToken: token,
      clientDiscriminator: clientDiscriminator(request),
      ipAddress: clientIpAddress(request),
      userAgent: requestUserAgent(request),
    });

    return jsonNoStore(
      { code: "SESSION_CREATED", returnTo: session.returnTo },
      200,
      { "Set-Cookie": buildSessionCookie(session.sessionToken) },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export function POST(request: Request) {
  return handleEmailAuthVerify(request, process.env);
}
