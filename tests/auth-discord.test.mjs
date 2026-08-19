import assert from "node:assert/strict";
import test from "node:test";
import {
  DiscordOAuthError,
  buildDiscordAuthorizeUrl,
  createDiscordConfig,
  exchangeDiscordCode,
  fetchDiscordIdentity,
} from "../infra/oauth/discord.ts";
import { createAuthService } from "../lib/auth-service.ts";
import { createPkcePair, sha256Hex } from "../lib/auth-security.ts";
import { handleDiscordStart } from "../app/api/auth/discord/start/route.ts";
import { handleDiscordCallback } from "../app/api/auth/discord/callback/route.ts";

const CLIENT_SECRET = "discord-client-secret-value";
const config = {
  clientId: "1234567890",
  clientSecret: CLIENT_SECRET,
  redirectUri: "https://riftory.example/api/auth/discord/callback",
};

const identityPayload = {
  id: "discord-account-id",
  email: " Player@Example.COM ",
  verified: true,
  global_name: "  Riftory   Oyuncusu ",
  username: "riftory",
};

function stubFetch(routes) {
  const calls = [];
  const send = async (url, init) => {
    calls.push({ url, init });
    const route = routes[new URL(url).pathname];
    if (!route) throw new Error(`beklenmeyen istek: ${url}`);
    return {
      ok: route.status < 400,
      status: route.status,
      json: async () => route.body,
    };
  };
  send.calls = calls;
  return send;
}

class FakeRepository {
  states = new Map();
  created = [];
  exchanges = [];
  rateDecision = { allowed: true, remaining: 4, retryAfterMs: 0, nextState: {} };
  exchangeResult = {
    userId: "user-id",
    sessionId: "session-id",
    sessionFamilyId: "family-id",
    email: "player@example.com",
    displayName: "Riftory Oyuncusu",
    returnTo: "/panel",
  };

  async takeRateLimit(input) {
    this.lastRateInput = input;
    return this.rateDecision;
  }

  async createOAuthState(input) {
    this.created.push(input);
    this.states.set(input.stateHash, input);
    return `state-${this.created.length}`;
  }

  async consumeOAuthState(input) {
    const stored = this.states.get(input.stateHash);
    if (!stored) return null;
    this.states.delete(input.stateHash);
    return { codeVerifier: stored.codeVerifier, returnTo: stored.returnTo };
  }

  async exchangeOAuthAccount(input) {
    this.exchanges.push(input);
    return this.exchangeResult;
  }
}

function setup(overrides = {}) {
  const repository = overrides.repository ?? new FakeRepository();
  const send = overrides.fetch ?? stubFetch({
    "/api/oauth2/token": { status: 200, body: { access_token: "discord-access-token" } },
    "/api/users/@me": { status: 200, body: identityPayload },
  });
  const service = createAuthService({
    repository,
    mailer: null,
    discord: { ...config, fetch: send },
    appOrigin: "https://riftory.example",
    rateLimitSecret: "s".repeat(32),
  });
  return { service, repository, send };
}

test("builds an authorize URL with PKCE and never exposes the verifier", async () => {
  const pkce = await createPkcePair();
  const url = new URL(buildDiscordAuthorizeUrl(config, { state: "a".repeat(43), codeChallenge: pkce.challenge }));

  assert.equal(url.origin + url.pathname, "https://discord.com/oauth2/authorize");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), pkce.challenge);
  assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
  assert.equal(url.searchParams.get("scope"), "identify email");
  assert.doesNotMatch(url.href, new RegExp(pkce.verifier));
  assert.doesNotMatch(url.href, new RegExp(CLIENT_SECRET));
});

test("derives the challenge as the S256 digest of the verifier", async () => {
  const pkce = await createPkcePair();
  const expected = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pkce.verifier));
  const encoded = btoa(String.fromCharCode(...new Uint8Array(expected)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

  assert.equal(pkce.challenge, encoded);
  assert.notEqual(pkce.challenge, pkce.verifier);
});

test("keeps the client secret out of the URL and out of failures", async () => {
  const send = stubFetch({ "/api/oauth2/token": { status: 200, body: { access_token: "token" } } });
  await exchangeDiscordCode({ ...config, fetch: send }, { code: "auth-code", codeVerifier: "v".repeat(43) });

  const [call] = send.calls;
  assert.equal(call.url, "https://discord.com/api/oauth2/token");
  assert.doesNotMatch(call.url, new RegExp(CLIENT_SECRET));
  assert.ok(call.init.body.includes(encodeURIComponent(CLIENT_SECRET)));

  const failing = stubFetch({ "/api/oauth2/token": { status: 401, body: {} } });
  await assert.rejects(
    () => exchangeDiscordCode({ ...config, fetch: failing }, { code: "bad", codeVerifier: "v".repeat(43) }),
    (error) => {
      assert.ok(error instanceof DiscordOAuthError);
      assert.equal(error.step, "token");
      assert.doesNotMatch(error.message, new RegExp(CLIENT_SECRET));
      return true;
    },
  );
});

test("refuses an identity without a verified address", async () => {
  const accepted = await fetchDiscordIdentity(
    { ...config, fetch: stubFetch({ "/api/users/@me": { status: 200, body: identityPayload } }) },
    "token",
  );
  assert.deepEqual(accepted, {
    providerAccountId: "discord-account-id",
    email: "player@example.com",
    displayName: "Riftory Oyuncusu",
  });

  for (const body of [
    { ...identityPayload, verified: false },
    { ...identityPayload, email: "" },
    { ...identityPayload, global_name: "", username: "" },
  ]) {
    const rejected = await fetchDiscordIdentity(
      { ...config, fetch: stubFetch({ "/api/users/@me": { status: 200, body } }) },
      "token",
    );
    assert.equal(rejected, null);
  }
});

test("stores the state hash and verifier, never the raw state", async () => {
  const { service, repository } = setup();
  const started = await service.startDiscordSignIn({
    returnTo: "/hesap",
    clientDiscriminator: "203.0.113.7",
  });

  const rawState = new URL(started.authorizeUrl).searchParams.get("state");
  const stored = repository.created[0];
  assert.equal(stored.stateHash, await sha256Hex(rawState));
  assert.notEqual(stored.stateHash, rawState);
  assert.equal(stored.returnTo, "/hesap");
  assert.match(stored.codeVerifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(repository.lastRateInput.scope, "discord-start");
});

test("rejects an unsafe return path before it reaches the database", async () => {
  const { service, repository } = setup();
  await service.startDiscordSignIn({ returnTo: "//evil.example", clientDiscriminator: "browser" });
  assert.equal(repository.created[0].returnTo, "/panel");
});

test("completes a callback into a session and consumes the state once", async () => {
  const { service, repository } = setup();
  const started = await service.startDiscordSignIn({ returnTo: "/hesap", clientDiscriminator: "browser" });
  const rawState = new URL(started.authorizeUrl).searchParams.get("state");

  const session = await service.completeDiscordSignIn({
    state: rawState,
    code: "auth-code",
    clientDiscriminator: "browser",
    ipAddress: "203.0.113.7",
  });

  assert.match(session.sessionToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(session.returnTo, "/hesap");
  const exchange = repository.exchanges[0];
  assert.equal(exchange.provider, "discord");
  assert.equal(exchange.providerAccountId, "discord-account-id");
  assert.equal(exchange.email, "player@example.com");
  assert.equal(exchange.sessionTokenHash, await sha256Hex(session.sessionToken));

  // A replayed callback finds no state left to consume.
  await assert.rejects(
    () => service.completeDiscordSignIn({ state: rawState, code: "auth-code", clientDiscriminator: "browser" }),
    (error) => error.code === "DISCORD_SIGN_IN_REJECTED" && error.status === 400,
  );
  assert.equal(repository.exchanges.length, 1);
});

test("answers every rejection reason with the same public error", async () => {
  const { service } = setup();
  const attempts = [
    { state: "not-a-state", code: "auth-code" },
    { state: "a".repeat(43), code: "" },
    { state: "a".repeat(43), code: "auth-code" },
  ];

  for (const attempt of attempts) {
    await assert.rejects(
      () => service.completeDiscordSignIn({ ...attempt, clientDiscriminator: "browser" }),
      (error) => error.code === "DISCORD_SIGN_IN_REJECTED" && error.status === 400,
    );
  }
});

test("treats a provider failure as a rejection without leaking the reason", async () => {
  const failing = stubFetch({
    "/api/oauth2/token": { status: 200, body: { access_token: "token" } },
    "/api/users/@me": { status: 500, body: {} },
  });
  const { service } = setup({ fetch: failing });
  const started = await service.startDiscordSignIn({ clientDiscriminator: "browser" });
  const rawState = new URL(started.authorizeUrl).searchParams.get("state");

  await assert.rejects(
    () => service.completeDiscordSignIn({ state: rawState, code: "auth-code", clientDiscriminator: "browser" }),
    (error) => error.code === "DISCORD_SIGN_IN_REJECTED",
  );
});

test("refuses Discord flows when credentials are absent", async () => {
  const service = createAuthService({
    repository: new FakeRepository(),
    mailer: null,
    discord: null,
    appOrigin: "https://riftory.example",
    rateLimitSecret: "s".repeat(32),
  });

  await assert.rejects(
    () => service.startDiscordSignIn({ clientDiscriminator: "browser" }),
    (error) => error.status === 503 && error.code === "AUTH_NOT_CONFIGURED",
  );
});

test("resolves the redirect URI from the application origin only", () => {
  assert.equal(
    createDiscordConfig({
      APP_ORIGIN: "https://riftory.example",
      DISCORD_CLIENT_ID: "id",
      DISCORD_CLIENT_SECRET: "secret",
    }).redirectUri,
    "https://riftory.example/api/auth/discord/callback",
  );
  assert.equal(createDiscordConfig({ DISCORD_CLIENT_ID: "id", DISCORD_CLIENT_SECRET: "secret" }), null);
  assert.equal(createDiscordConfig({ APP_ORIGIN: "https://riftory.example" }), null);
});

test("redirects the browser to Discord and back into a session cookie", async () => {
  const { service } = setup();
  const environment = { APP_ORIGIN: "https://riftory.example" };

  const start = await handleDiscordStart(
    new Request("https://riftory.example/api/auth/discord/start?return_to=%2Fhesap"),
    environment,
    { service },
  );
  assert.equal(start.status, 302);
  const authorizeUrl = new URL(start.headers.get("location"));
  assert.equal(authorizeUrl.host, "discord.com");
  assert.match(start.headers.get("cache-control") ?? "", /no-store/);

  const callback = await handleDiscordCallback(
    new Request(`https://riftory.example/api/auth/discord/callback?code=auth-code&state=${authorizeUrl.searchParams.get("state")}`),
    environment,
    { service },
  );
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.get("location"), "/hesap");
  assert.match(callback.headers.get("set-cookie") ?? "", /^__Host-riftory_session=[A-Za-z0-9_-]{43};/);
  assert.match(callback.headers.get("set-cookie") ?? "", /HttpOnly/);
});

test("sends a cancelled or rejected visitor back with a neutral marker", async () => {
  const { service } = setup();
  const environment = { APP_ORIGIN: "https://riftory.example" };

  const cancelled = await handleDiscordCallback(
    new Request("https://riftory.example/api/auth/discord/callback?error=access_denied"),
    environment,
    { service },
  );
  assert.equal(cancelled.status, 303);
  assert.equal(cancelled.headers.get("location"), "/giris?discord=rejected");
  assert.equal(cancelled.headers.get("set-cookie"), null);

  const rejected = await handleDiscordCallback(
    new Request("https://riftory.example/api/auth/discord/callback?code=x&state=unknown"),
    environment,
    { service },
  );
  assert.equal(rejected.headers.get("location"), "/giris?discord=rejected");
});

test("keeps Discord endpoints honest when the environment is not configured", async () => {
  const start = await handleDiscordStart(
    new Request("https://riftory.example/api/auth/discord/start"),
    {},
  );
  assert.equal(start.status, 503);
  assert.deepEqual(await start.json(), {
    code: "AUTH_NOT_CONFIGURED",
    message: "Discord girişi henüz etkin değil.",
  });
});
