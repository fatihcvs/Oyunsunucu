import assert from "node:assert/strict";
import test from "node:test";
import { join, normalize, sep } from "node:path";
import {
  allowedRequestOrigins,
  assertMutationRequest,
  clientDiscriminator,
  clientIpAddress,
} from "../lib/auth-http.ts";
import { resolveAssetPath } from "../lib/asset-path.ts";
import { handleEmailAuthStart } from "../app/api/auth/email/start/route.ts";

const origin = "https://riftory.example";

function request(headers = {}) {
  return new Request(`${origin}/api/auth/email/start`, { method: "POST", headers });
}

test("takes the client address from the hop the proxy appended, not the caller's", () => {
  // The caller controls everything left of the proxy's own entry.
  assert.equal(clientIpAddress(request({ "x-forwarded-for": "203.0.113.9" })), "203.0.113.9");
  assert.equal(
    clientIpAddress(request({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" })),
    "203.0.113.9",
  );
  assert.equal(
    clientIpAddress(request({ "x-forwarded-for": "evil, 10.0.0.1, 203.0.113.9" })),
    "203.0.113.9",
  );
});

test("a forged forwarding header cannot mint a fresh rate-limit bucket", () => {
  const buckets = new Set();
  for (const forged of ["attacker-1", "attacker-2", "attacker-3"]) {
    buckets.add(clientDiscriminator(request({ "x-forwarded-for": forged })));
  }

  // Unrecognisable values all collapse into one shared bucket instead of
  // handing out a new allowance per header value.
  assert.deepEqual([...buckets], ["unknown-client"]);
  assert.equal(clientDiscriminator(request()), "unknown-client");
});

test("refuses to store anything that is not an address in an inet column", () => {
  const rejected = [
    "'; DROP TABLE users; --",
    "not-an-ip",
    "999.999.999.999.999.999",
    "x".repeat(80),
    "",
  ];

  for (const value of rejected) {
    assert.equal(clientIpAddress(request({ "x-forwarded-for": value })), null, value);
  }
  assert.equal(clientIpAddress(request({ "x-forwarded-for": "2001:db8::1" })), "2001:db8::1");
});

test("a request cannot vouch for its own origin once one is configured", () => {
  // The URL origin comes from the Host header, so trusting it would let the
  // caller nominate the origin the CSRF check compares against.
  const spoofed = new Request("https://evil.example/api/auth/email/start", { method: "POST" });
  assert.deepEqual(allowedRequestOrigins(spoofed, origin), [origin]);
  assert.deepEqual(allowedRequestOrigins(spoofed), ["https://evil.example"]);
});

test("rejects a cross-origin mutation even when the host header agrees with it", async () => {
  const response = await handleEmailAuthStart(
    new Request("https://evil.example/api/auth/email/start", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ mode: "signin", email: "player@example.com" }),
    }),
    { APP_ORIGIN: origin },
  );

  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "ORIGIN_REJECTED");
});

test("keeps static asset reads inside the build output", () => {
  const resolver = { root: `${sep}app${sep}dist${sep}client${sep}`, separator: sep, join, normalize };
  const escapes = [
    "/../../../etc/passwd",
    "/..%2f..%2f.env",
    "/assets/../../package.json",
    "/%2e%2e/%2e%2e/.env",
  ];

  for (const pathname of escapes) {
    assert.equal(resolveAssetPath(pathname, resolver), null, pathname);
  }
  assert.notEqual(resolveAssetPath("/assets/app.css", resolver), null);
});

test("answers a malformed or truncating path with nothing instead of throwing", () => {
  const resolver = { root: `${sep}app${sep}dist${sep}client${sep}`, separator: sep, join, normalize };

  // `%` with no valid hex digits makes decodeURIComponent throw; a NUL byte can
  // truncate the name inside the filesystem layer.
  assert.equal(resolveAssetPath("/%", resolver), null);
  assert.equal(resolveAssetPath("/%zz", resolver), null);
  assert.equal(resolveAssetPath("/assets/app.css%00.png", resolver), null);
  assert.equal(resolveAssetPath("/", resolver), null);
});

test("never accepts a mutation without an origin header", async () => {
  await assert.rejects(
    async () => assertMutationRequest(
      new Request(`${origin}/api/auth/signout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
      origin,
    ),
    (error) => error.status === 403 && error.code === "ORIGIN_REJECTED",
  );
});
