import {
  clientIpAddress,
  assertMutationRequest,
  errorResponse,
  jsonNoStore,
  parseSignOutScope,
  requestUserAgent,
  requireLiveAuthService,
} from "../../../../lib/auth-http.ts";
import {
  resolveAuthService,
  type AuthCompositionOverrides,
} from "../../../../lib/auth-composition.ts";
import type { AuthEnvironment } from "../../../../lib/auth-runtime.ts";
import { buildExpiredSessionCookie } from "../../../../lib/auth-security.ts";
import { readSessionToken } from "../../../../lib/auth-session.ts";

export const dynamic = "force-dynamic";

/**
 * Always clears the browser cookie, even when no live session matched, so a
 * revoked or unknown token can never be replayed from this device.
 */
export async function handleSignOut(
  request: Request,
  environment: AuthEnvironment,
  overrides: AuthCompositionOverrides = {},
) {
  try {
    assertMutationRequest(request, environment.APP_ORIGIN);
    const service = requireLiveAuthService(resolveAuthService(environment, overrides));
    const scope = await parseSignOutScope(request);
    const rawToken = readSessionToken(request);

    const command = {
      rawToken: rawToken ?? "",
      ipAddress: clientIpAddress(request),
      userAgent: requestUserAgent(request),
    };
    const result = !rawToken
      ? { revokedSessions: 0 }
      : scope === "all"
        ? await service.signOutEverywhere(command)
        : await service.signOut(command);

    return jsonNoStore(
      { code: "SIGNED_OUT", scope, revokedSessions: result.revokedSessions },
      200,
      { "Set-Cookie": buildExpiredSessionCookie() },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export function POST(request: Request) {
  return handleSignOut(request, process.env);
}
