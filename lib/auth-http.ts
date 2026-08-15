import {
  DEFAULT_AUTH_RETURN_TO,
  createRegistrationIntent,
  isSafeReturnPath,
  isValidEmail,
  normalizeEmail,
} from "./auth-contracts.ts";
import { isAllowedMutationOrigin } from "./auth-security.ts";

export const AUTH_REQUEST_MAX_BYTES = 4_096;

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

export function jsonNoStore(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function errorResponse(error: unknown) {
  if (error instanceof AuthHttpError) {
    return jsonNoStore({ code: error.code, message: error.message }, error.status);
  }

  return jsonNoStore(
    { code: "INTERNAL_ERROR", message: "İstek şu anda tamamlanamadı." },
    500,
  );
}

export function allowedRequestOrigins(request: Request, appOrigin?: string) {
  const origins = [new URL(request.url).origin];
  if (appOrigin) {
    try {
      origins.push(new URL(appOrigin).origin);
    } catch {
      // Invalid configuration is intentionally ignored instead of widening trust.
    }
  }
  return [...new Set(origins)];
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

export async function parseEmailAuthStartRequest(request: Request): Promise<EmailAuthStartPayload> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > AUTH_REQUEST_MAX_BYTES) {
    throw new AuthHttpError(413, "REQUEST_TOO_LARGE", "İstek gövdesi çok büyük.");
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AuthHttpError(400, "INVALID_JSON", "Geçerli bir JSON gövdesi gönderin.");
  }

  if (!isPlainRecord(body)) {
    throw new AuthHttpError(400, "INVALID_REQUEST", "Giriş bilgileri geçersiz.");
  }

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
