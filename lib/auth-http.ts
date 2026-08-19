import {
  DEFAULT_AUTH_RETURN_TO,
  createRegistrationIntent,
  isSafeReturnPath,
  isValidEmail,
  normalizeEmail,
} from "./auth-contracts.ts";
import { isAllowedMutationOrigin } from "./auth-security.ts";
import { AuthFlowError, type AuthService } from "./auth-service.ts";
import type { AuthResolution } from "./auth-composition.ts";

export const AUTH_REQUEST_MAX_BYTES = 4_096;
export const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export class AuthHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthHttpError";
    this.status = status;
    this.code = code;
  }
}

export type EmailAuthStartPayload = {
  mode: "signin" | "register";
  email: string;
  displayName: string | null;
  consentVersion: string | null;
  returnTo: string;
};

export function jsonNoStore(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

export function errorResponse(error: unknown) {
  if (error instanceof AuthHttpError) {
    return jsonNoStore({ code: error.code, message: error.message }, error.status);
  }

  if (error instanceof AuthFlowError) {
    return jsonNoStore(
      { code: error.code, message: error.message },
      error.status,
      error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : {},
    );
  }

  return jsonNoStore(
    { code: "INTERNAL_ERROR", message: "İstek şu anda tamamlanamadı." },
    500,
  );
}

/** Turns an unusable composition result into the honest public error for that reason. */
export function requireLiveAuthService(
  resolution: AuthResolution,
  notConfiguredMessage = "Canlı giriş henüz etkin değil.",
): AuthService {
  if (resolution.status === "not_configured") {
    throw new AuthHttpError(503, "AUTH_NOT_CONFIGURED", notConfiguredMessage);
  }
  if (resolution.status === "adapter_not_bound") {
    throw new AuthHttpError(
      503,
      "AUTH_ADAPTER_NOT_BOUND",
      "Kimlik deposu bağlantısı yayın ortamında henüz etkin değil.",
    );
  }
  return resolution.service;
}

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:]{2,45}$/i;

/**
 * The client address the platform vouches for.
 *
 * `X-Forwarded-For` grows left to right, and only the rightmost entry was
 * appended by the proxy in front of us — everything to its left is whatever the
 * caller chose to send. Reading the leftmost hop would let anyone rotate a
 * header value to get a fresh rate-limit bucket, and would write attacker text
 * into an `inet` column. Anything that is not an address shape is dropped.
 */
export function clientIpAddress(request: Request) {
  const hops = request.headers.get("x-forwarded-for")?.split(",") ?? [];
  const candidate = hops.at(-1)?.trim() ?? "";
  if (candidate.length > 45) return null;

  return IPV4.test(candidate) || IPV6.test(candidate) ? candidate : null;
}

/** Rate-limit identity for one client; unknown callers share one bucket rather than getting a free one each. */
export function clientDiscriminator(request: Request) {
  return clientIpAddress(request) ?? "unknown-client";
}

export function requestUserAgent(request: Request) {
  return request.headers.get("user-agent")?.slice(0, 512) ?? null;
}

/**
 * Origins allowed to send a state-changing request.
 *
 * When `APP_ORIGIN` is configured it is the only trusted value. The request's
 * own origin is derived from the `Host` header, which the caller supplies, so
 * accepting it would let a request vouch for itself. The derived origin is used
 * only as a fallback for local development, where no origin is configured yet.
 */
export function allowedRequestOrigins(request: Request, appOrigin?: string) {
  if (appOrigin) {
    try {
      return [new URL(appOrigin).origin];
    } catch {
      // Invalid configuration is intentionally ignored instead of widening trust.
    }
  }

  return [new URL(request.url).origin];
}

export function assertMutationRequest(request: Request, appOrigin?: string) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), allowedRequestOrigins(request, appOrigin))) {
    throw new AuthHttpError(403, "ORIGIN_REJECTED", "İstek kaynağı doğrulanamadı.");
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new AuthHttpError(415, "JSON_REQUIRED", "İstek JSON biçiminde olmalıdır.");
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > AUTH_REQUEST_MAX_BYTES) {
    throw new AuthHttpError(413, "REQUEST_TOO_LARGE", "İstek gövdesi çok büyük.");
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export async function readJsonRecord(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > AUTH_REQUEST_MAX_BYTES) {
    throw new AuthHttpError(413, "REQUEST_TOO_LARGE", "İstek gövdesi çok büyük.");
  }

  let body: unknown;
  try {
    // An empty body is a valid "no fields" request; each parser still validates what it needs.
    body = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new AuthHttpError(400, "INVALID_JSON", "Geçerli bir JSON gövdesi gönderin.");
  }

  if (!isPlainRecord(body)) {
    throw new AuthHttpError(400, "INVALID_REQUEST", "Giriş bilgileri geçersiz.");
  }
  return body;
}

/** Accepts only the opaque token shape, so malformed input never reaches a hash comparison. */
export async function parseMagicLinkTokenRequest(request: Request): Promise<string> {
  const body = await readJsonRecord(request);
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!OPAQUE_TOKEN_PATTERN.test(token)) {
    throw new AuthHttpError(400, "INVALID_OR_EXPIRED_LINK", "Bağlantı geçersiz veya süresi dolmuş.");
  }
  return token;
}

/**
 * Only shape-checks the envelope; the draft itself and the key format are
 * validated where the import command is built, so both callers share one rule.
 */
export async function parseDraftImportRequest(request: Request) {
  const body = await readJsonRecord(request);
  const importKey = typeof body.importKey === "string" ? body.importKey.trim() : "";
  if (!importKey || body.draft === undefined) {
    throw new AuthHttpError(400, "INVALID_DRAFT", "Sunucu taslağı veya aktarım anahtarı geçersiz.");
  }
  return { importKey, draft: body.draft };
}

export async function parseSignOutScope(request: Request): Promise<"current" | "all"> {
  const body = await readJsonRecord(request);
  if (body.scope === undefined || body.scope === "current") return "current";
  if (body.scope === "all") return "all";
  throw new AuthHttpError(400, "INVALID_REQUEST", "Çıkış kapsamı geçersiz.");
}

export async function parseAdminPasswordSignInRequest(request: Request) {
  const body = await readJsonRecord(request);
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || email.length > 254 || !password || new TextEncoder().encode(password).byteLength > 1_024) {
    throw new AuthHttpError(400, "INVALID_ADMIN_CREDENTIALS", "E-posta veya parola geçersiz.");
  }
  return { email, password };
}

export async function parseEmailAuthStartRequest(request: Request): Promise<EmailAuthStartPayload> {
  const body = await readJsonRecord(request);

  const mode = body.mode === "register" ? "register" : body.mode === "signin" ? "signin" : null;
  const email = typeof body.email === "string" ? body.email : "";
  const returnTo = typeof body.returnTo === "string" && isSafeReturnPath(body.returnTo)
    ? body.returnTo
    : DEFAULT_AUTH_RETURN_TO;

  if (!mode || !isValidEmail(email)) {
    throw new AuthHttpError(400, "INVALID_IDENTITY", "E-posta veya akış türü geçersiz.");
  }

  if (mode === "register") {
    const intent = createRegistrationIntent({
      displayName: typeof body.displayName === "string" ? body.displayName : "",
      email,
      returnTo,
    });
    if (!intent) {
      throw new AuthHttpError(400, "INVALID_IDENTITY", "Ad veya e-posta bilgisi geçersiz.");
    }
    return {
      mode,
      email: intent.email,
      displayName: intent.displayName,
      consentVersion: intent.consentVersion,
      returnTo: intent.returnTo,
    };
  }

  return {
    mode,
    email: normalizeEmail(email),
    displayName: null,
    consentVersion: null,
    returnTo,
  };
}
