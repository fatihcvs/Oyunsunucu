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

class FakeAuthService {
  requests = [];

  async requestMagicLink(input) {
    this.requests.push(input);
    return {
      accepted: true,
      code: "MAGIC_LINK_ACCEPTED",
      message: "Adres uygunsa tek kullanımlık giriş bağlantısı gönderilecektir.",
    };
  }
}

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

test("rejects malformed and oversized requests once the service is live", async () => {
  const overrides = { service: new FakeAuthService() };

  const malformed = await handleEmailAuthStart(request("{"), configuredEnvironment, overrides);
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).code, "INVALID_JSON");

  const oversized = await handleEmailAuthStart(
    request(JSON.stringify({ mode: "signin", email: `${"a".repeat(4_100)}@example.com` })),
    configuredEnvironment,
    overrides,
  );
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, "REQUEST_TOO_LARGE");
  assert.equal(overrides.service.requests.length, 0);
});

test("hands a normalized identity and a client bucket to the live service", async () => {
  const service = new FakeAuthService();
  const response = await handleEmailAuthStart(
    request(
      JSON.stringify({ mode: "register", email: " PLAYER@EXAMPLE.COM ", displayName: "  Riftory  Oyuncusu ", returnTo: "/hesap" }),
      { headers: { "x-forwarded-for": "203.0.113.7" } },
    ),
    configuredEnvironment,
    { service },
  );

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    code: "MAGIC_LINK_ACCEPTED",
    message: "Adres uygunsa tek kullanımlık giriş bağlantısı gönderilecektir.",
  });
  assert.deepEqual(service.requests[0], {
    mode: "register",
    email: "player@example.com",
    displayName: "Riftory Oyuncusu",
    returnTo: "/hesap",
    clientDiscriminator: "203.0.113.7",
    requestedIp: "203.0.113.7",
  });
});

test("answers an unreachable database with a retryable 503, never a bare 500", async () => {
  const unreachable = {
    takeRateLimit: async () => { throw new Error("ECONNREFUSED"); },
  };
  const response = await handleEmailAuthStart(
    request(JSON.stringify({ mode: "signin", email: "PLAYER@EXAMPLE.COM", returnTo: "/hesap" })),
    configuredEnvironment,
    { repository: unreachable },
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    code: "AUTH_UNAVAILABLE",
    message: "Giriş hizmeti şu anda kullanılamıyor.",
  });
});

test("reports the adapter as unbound only where the driver cannot run", async () => {
  const response = await handleEmailAuthStart(
    request(JSON.stringify({ mode: "signin", email: "player@example.com" })),
    configuredEnvironment,
    { repository: null },
  );

  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "AUTH_ADAPTER_NOT_BOUND");
});
