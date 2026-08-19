import {
  errorResponse,
  jsonNoStore,
  requireLiveAuthService,
} from "../../../../lib/auth-http.ts";
import {
  resolveAuthService,
  type AuthCompositionOverrides,
} from "../../../../lib/auth-composition.ts";
import type { AuthEnvironment } from "../../../../lib/auth-runtime.ts";
import { buildExpiredSessionCookie } from "../../../../lib/auth-security.ts";
import { publicSessionView, readSessionToken } from "../../../../lib/auth-session.ts";

export const dynamic = "force-dynamic";

export async function handleSessionRead(
  request: Request,
  environment: AuthEnvironment,
  overrides: AuthCompositionOverrides = {},
) {
  try {
    const service = requireLiveAuthService(resolveAuthService(environment, overrides));
    const rawToken = readSessionToken(request);
    const session = rawToken ? await service.authenticateSession(rawToken) : null;

    if (!session) {
      // A presented-but-dead cookie is cleared so the browser stops replaying it.
      return jsonNoStore(
        { authenticated: false },
        200,
        rawToken ? { "Set-Cookie": buildExpiredSessionCookie() } : {},
      );
    }

    return jsonNoStore(publicSessionView(session));
  } catch (error) {
    return errorResponse(error);
  }
}

export function GET(request: Request) {
  return handleSessionRead(request, process.env);
}
