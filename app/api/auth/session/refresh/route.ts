import {
  clientIpAddress,
  assertMutationRequest,
  errorResponse,
  jsonNoStore,
  requestUserAgent,
  requireLiveAuthService,
} from "../../../../../lib/auth-http.ts";
import {
  resolveAuthService,
  type AuthCompositionOverrides,
} from "../../../../../lib/auth-composition.ts";
import type { AuthEnvironment } from "../../../../../lib/auth-runtime.ts";
import { buildExpiredSessionCookie, buildSessionCookie } from "../../../../../lib/auth-security.ts";
import { readSessionToken } from "../../../../../lib/auth-session.ts";

export const dynamic = "force-dynamic";

export async function handleSessionRefresh(
  request: Request,
  environment: AuthEnvironment,
  overrides: AuthCompositionOverrides = {},
) {
  try {
    assertMutationRequest(request, environment.APP_ORIGIN);
    const service = requireLiveAuthService(resolveAuthService(environment, overrides));
    const rawToken = readSessionToken(request);
    const rotated = rawToken
      ? await service.rotateSession({
        rawToken,
        ipAddress: clientIpAddress(request),
        userAgent: requestUserAgent(request),
      })
      : null;

    if (!rotated) {
      return jsonNoStore(
        { code: "SESSION_NOT_ACTIVE", message: "Oturum bulunamadı veya süresi dolmuş." },
        401,
        { "Set-Cookie": buildExpiredSessionCookie() },
      );
    }

    return jsonNoStore(
      { code: "SESSION_ROTATED", expiresAt: rotated.expiresAt.toISOString() },
      200,
      { "Set-Cookie": buildSessionCookie(rotated.sessionToken) },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export function POST(request: Request) {
  return handleSessionRefresh(request, process.env);
}
