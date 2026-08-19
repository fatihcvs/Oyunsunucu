import {
  AuthHttpError,
  assertMutationRequest,
  clientDiscriminator,
  clientIpAddress,
  errorResponse,
  jsonNoStore,
  readJsonRecord,
  requestUserAgent,
} from "../../../../lib/auth-http.ts";
import { buildSessionCookie } from "../../../../lib/auth-security.ts";
import type { AuthEnvironment } from "../../../../lib/auth-runtime.ts";
import { resolveSessionAuthService, type AuthCompositionOverrides } from "../../../../lib/auth-composition.ts";

export const dynamic = "force-dynamic";

/**
 * Email-and-password registration and sign-in.
 *
 * One route with a `mode` rather than two, because both paths share the origin
 * check, the rate-limit bucket and the cookie shape; splitting them would mean
 * keeping three things in step across two files.
 */
export async function handlePasswordAuth(
  request: Request,
  environment: AuthEnvironment,
  overrides: AuthCompositionOverrides = {},
) {
  try {
    assertMutationRequest(request, environment.APP_ORIGIN);

    // Password sign-in needs a database and a session secret, not a mail
    // provider: requiring one would keep customers out whenever delivery is off,
    // which is exactly the state the closed beta runs in.
    const resolution = resolveSessionAuthService(environment, overrides);
    if (resolution.status === "not_configured") {
      throw new AuthHttpError(503, "AUTH_NOT_CONFIGURED", "Hesap sistemi henüz etkin değil.");
    }
    if (resolution.status === "adapter_not_bound") {
      throw new AuthHttpError(503, "AUTH_ADAPTER_NOT_BOUND", "Kimlik deposu bağlantısı henüz etkin değil.");
    }

    const body = await readJsonRecord(request);
    if (body.mode !== "register" && body.mode !== "signin") {
      throw new AuthHttpError(400, "INVALID_MODE", "Akış türü geçersiz.");
    }

    const credentials = {
      email: body.email,
      password: body.password,
      displayName: body.displayName,
      clientDiscriminator: clientDiscriminator(request),
      ipAddress: clientIpAddress(request),
      userAgent: requestUserAgent(request),
    };
    const result = body.mode === "register"
      ? await resolution.service.registerWithPassword(credentials)
      : await resolution.service.signInWithPassword(credentials);

    return jsonNoStore(
      { authenticated: true, returnTo: result.returnTo, displayName: result.displayName },
      body.mode === "register" ? 201 : 200,
      { "Set-Cookie": buildSessionCookie(result.sessionToken) },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export function POST(request: Request) {
  return handlePasswordAuth(request, process.env);
}
