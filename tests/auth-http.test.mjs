import assert from "node:assert/strict";
import test from "node:test";
import { handleEmailAuthStart } from "../app/api/auth/email/start/route.ts";

const origin = "https://riftory.example";
const configuredEnvironment = {
  APP_ORIGIN: origin,
  DATABASE_URL: "postgresql://riftory:secret@database.internal:5432/riftory",
  AUTH_SECRET: "s".repeat(32),
  EMAIL_FROM: "hello@riftory.example",
  RESEND_API_KEY: "re_12345678901234567890",
};

function request(body, options = {}) {
  return new Request(`${origin}/api/auth/email/start`, {
    method: "POST",
    body,
    headers: {
      origin,
      "content-type": "application/json",
      ...options.headers,
    },
  });
}

test("rejects cross-origin authentication mutations before reading identity data", async () => {
  const response = await handleEmailAuthStart(
    request(JSON.stringify({ mode: "signin", email: "player@example.com" }), {
      headers: { origin: "https://evil.example" },
    }),
    configuredEnvironment,
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    code: "ORIGIN_REJECTED",
    message: "İstek kaynağı doğrulanamadı.",
  });
});

test("returns an honest 503 without parsing PII when live auth is not configured", async () => {
  const response = await handleEmailAuthStart(
    request(JSON.stringify({ mode: "signin", email: "player@example.com" })),
    {},
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    code: "AUTH_NOT_CONFIGURED",
    message: "Canlı e-posta girişi henüz etkin değil.",
  });
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("rejects malformed and oversized configured requests", async () => {
  const malformed = await handleEmailAuthStart(request("{"), configuredEnvironment);
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).code, "INVALID_JSON");

  const oversized = await handleEmailAuthStart(
    request(JSON.stringify({ mode: "signin", email: `${"a".repeat(4_100)}@example.com` })),
    configuredEnvironment,
  );
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, "REQUEST_TOO_LARGE");
});

test("does not pretend the PostgreSQL adapter is bound when configuration exists", async () => {
  const response = await handleEmailAuthStart(
    request(JSON.stringify({ mode: "signin", email: "PLAYER@EXAMPLE.COM", returnTo: "/hesap" })),
    configuredEnvironment,
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    code: "AUTH_ADAPTER_NOT_BOUND",
    message: "Kimlik deposu bağlantısı yayın ortamında henüz etkin değil.",
  });
});
