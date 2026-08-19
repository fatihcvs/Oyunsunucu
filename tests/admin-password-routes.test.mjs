import assert from "node:assert/strict";
import test from "node:test";
import { handleAdminPasswordSignIn } from "../app/api/admin/session/route.ts";
import { SESSION_COOKIE_NAME } from "../lib/auth-security.ts";

const origin = "https://riftory.example";
const environment = { APP_ORIGIN: origin };

function request(body, requestOrigin = origin) {
  return new Request(`${origin}/api/admin/session`, {
    method: "POST",
    headers: {
      origin: requestOrigin,
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.20, 203.0.113.9",
      "user-agent": "route-test",
    },
    body: JSON.stringify(body),
  });
}

test("admin password route rejects foreign origins before touching credentials", async () => {
  let called = false;
  const response = await handleAdminPasswordSignIn(
    request({ email: "admin@example.com", password: "secret" }, "https://attacker.example"),
    environment,
    { service: { async signIn() { called = true; } } },
  );
  assert.equal(response.status, 403);
  assert.equal(called, false);
});

test("admin password route creates a secure host-only session cookie", async () => {
  let received;
  const response = await handleAdminPasswordSignIn(
    request({ email: "admin@example.com", password: "secret" }),
    environment,
    {
      service: {
        async signIn(input) {
          received = input;
          return { sessionToken: "a".repeat(43), role: "operator", expiresAt: new Date() };
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(received.clientDiscriminator, "203.0.113.9");
  assert.equal(received.ipAddress, "203.0.113.9");
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, new RegExp(`^${SESSION_COOKIE_NAME}=${"a".repeat(43)}`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /Domain=/);
  assert.deepEqual(await response.json(), { authenticated: true, returnTo: "/admin" });
});

test("admin password route reports missing Railway configuration honestly", async () => {
  const response = await handleAdminPasswordSignIn(
    request({ email: "admin@example.com", password: "secret" }),
    {},
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "ADMIN_PASSWORD_NOT_CONFIGURED");
});

test("password change requires a session cookie and same-origin request", async () => {
  const { handleAdminPasswordChange } = await import("../app/api/admin/password/route.ts");
  let called = false;
  const overrides = { service: { async changePassword() { called = true; return {}; } } };

  const foreign = await handleAdminPasswordChange(
    new Request(`${origin}/api/admin/password`, {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "a", newPassword: "b" }),
    }),
    environment,
    overrides,
  );
  assert.equal(foreign.status, 403);

  const anonymous = await handleAdminPasswordChange(
    new Request(`${origin}/api/admin/password`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "a", newPassword: "b" }),
    }),
    environment,
    overrides,
  );
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).code, "SESSION_REQUIRED");
  assert.equal(called, false);
});

test("password change passes both passwords through and never echoes them back", async () => {
  const { handleAdminPasswordChange } = await import("../app/api/admin/password/route.ts");
  let received;
  const response = await handleAdminPasswordChange(
    new Request(`${origin}/api/admin/password`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE_NAME}=${"a".repeat(43)}`,
      },
      body: JSON.stringify({ currentPassword: "eski parola", newPassword: "yeni parola 2026" }),
    }),
    environment,
    {
      service: {
        async changePassword(input) {
          received = input;
          return { changed: true, revokedSessions: 1, message: "Parola değiştirildi." };
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(received.currentPassword, "eski parola");
  assert.equal(received.newPassword, "yeni parola 2026");
  assert.equal(received.rawToken, "a".repeat(43));
  const body = await response.text();
  assert.equal(body.includes("yeni parola 2026"), false);
  assert.equal(body.includes("eski parola"), false);
});
