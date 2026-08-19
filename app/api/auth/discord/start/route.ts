import {
  clientIpAddress,
  clientDiscriminator,
  errorResponse,
  requireLiveAuthService,
} from "../../../../../lib/auth-http.ts";
import {
  resolveAuthService,
  type AuthCompositionOverrides,
} from "../../../../../lib/auth-composition.ts";
import type { AuthEnvironment } from "../../../../../lib/auth-runtime.ts";

export const dynamic = "force-dynamic";

const NOT_CONFIGURED = "Discord girişi henüz etkin değil.";

/**
 * Browser navigation, so there is no origin header to check: the single-use
 * `state` stored server-side is what binds this redirect to its callback.
 */
export async function handleDiscordStart(
  request: Request,
  environment: AuthEnvironment,
  overrides: AuthCompositionOverrides = {},
) {
  try {
    const service = requireLiveAuthService(resolveAuthService(environment, overrides), NOT_CONFIGURED);
    const { authorizeUrl } = await service.startDiscordSignIn({
      returnTo: new URL(request.url).searchParams.get("return_to"),
      clientDiscriminator: clientDiscriminator(request),
      requestedIp: clientIpAddress(request),
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: authorizeUrl,
        "Cache-Control": "no-store, max-age=0",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export function GET(request: Request) {
  return handleDiscordStart(request, process.env);
}
