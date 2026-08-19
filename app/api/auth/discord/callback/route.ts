import {
  clientIpAddress,
  clientDiscriminator,
  errorResponse,
  requestUserAgent,
  requireLiveAuthService,
} from "../../../../../lib/auth-http.ts";
import {
  resolveAuthService,
  type AuthCompositionOverrides,
} from "../../../../../lib/auth-composition.ts";
import type { AuthEnvironment } from "../../../../../lib/auth-runtime.ts";
import { buildSessionCookie } from "../../../../../lib/auth-security.ts";
import { AuthFlowError } from "../../../../../lib/auth-service.ts";

export const dynamic = "force-dynamic";

const NOT_CONFIGURED = "Discord girişi henüz etkin değil.";
const REJECTED_REDIRECT = "/giris?discord=rejected";

function redirect(location: string, cookie?: string) {
  const headers = new Headers({
    Location: location,
    "Cache-Control": "no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
  });
  if (cookie) headers.set("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

/**
 * Finishes the Discord flow and lands the user on their return path.
 *
 * A rejected attempt redirects to the sign-in page with a neutral marker rather
 * than rendering provider errors: the visitor gets a way forward and a probe
 * learns nothing about which step failed.
 */
export async function handleDiscordCallback(
  request: Request,
  environment: AuthEnvironment,
  overrides: AuthCompositionOverrides = {},
) {
  const query = new URL(request.url).searchParams;

  try {
    const service = requireLiveAuthService(resolveAuthService(environment, overrides), NOT_CONFIGURED);

    // The user pressed cancel on Discord's consent screen.
    if (query.get("error")) return redirect(REJECTED_REDIRECT);

    const session = await service.completeDiscordSignIn({
      state: query.get("state") ?? "",
      code: query.get("code") ?? "",
      clientDiscriminator: clientDiscriminator(request),
      ipAddress: clientIpAddress(request),
      userAgent: requestUserAgent(request),
    });

    return redirect(session.returnTo, buildSessionCookie(session.sessionToken));
  } catch (error) {
    // Only a rejected sign-in becomes a redirect; rate limits and misconfiguration
    // keep their own status so the problem stays visible.
    if (error instanceof AuthFlowError && error.code === "DISCORD_SIGN_IN_REJECTED") {
      return redirect(REJECTED_REDIRECT);
    }
    return errorResponse(error);
  }
}

export function GET(request: Request) {
  return handleDiscordCallback(request, process.env);
}
