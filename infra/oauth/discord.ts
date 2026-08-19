export const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
export const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
export const DISCORD_IDENTITY_URL = "https://discord.com/api/users/@me";
export const DISCORD_SCOPE = "identify email";
export const DISCORD_REQUEST_TIMEOUT_MS = 10_000;

export type DiscordConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export type DiscordIdentity = {
  providerAccountId: string;
  email: string;
  displayName: string;
};

/** Carries only the failing step and HTTP status; never the client secret or token. */
export class DiscordOAuthError extends Error {
  readonly step: "token" | "identity";
  readonly status: number | null;

  constructor(step: "token" | "identity", status: number | null) {
    super(`Discord ${step} adımı tamamlanamadı.`);
    this.name = "DiscordOAuthError";
    this.step = step;
    this.status = status;
  }
}

export function buildDiscordAuthorizeUrl(config: DiscordConfig, input: {
  state: string;
  codeChallenge: string;
}) {
  const url = new URL(DISCORD_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", DISCORD_SCOPE);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "consent");
  return url.href;
}

async function requestDiscord(
  step: "token" | "identity",
  config: DiscordConfig,
  url: string,
  init: RequestInit,
) {
  const send = config.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await send(url, {
      ...init,
      signal: AbortSignal.timeout(config.timeoutMs ?? DISCORD_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new DiscordOAuthError(step, null);
  }

  if (!response.ok) throw new DiscordOAuthError(step, response.status);

  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    throw new DiscordOAuthError(step, response.status);
  }
}

/**
 * Exchanges the authorization code for an access token.
 *
 * The client secret goes in the form body over TLS to Discord only; it is never
 * put in a URL, logged, or returned to the caller.
 */
export async function exchangeDiscordCode(config: DiscordConfig, input: {
  code: string;
  codeVerifier: string;
}) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: config.redirectUri,
    code_verifier: input.codeVerifier,
  });

  const payload = await requestDiscord("token", config, DISCORD_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  if (!accessToken) throw new DiscordOAuthError("token", null);
  return accessToken;
}

/** Requires a verified address: an unverified one would let anyone claim an account. */
export async function fetchDiscordIdentity(
  config: DiscordConfig,
  accessToken: string,
): Promise<DiscordIdentity | null> {
  const payload = await requestDiscord("identity", config, DISCORD_IDENTITY_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  const providerAccountId = typeof payload.id === "string" ? payload.id : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLocaleLowerCase("en-US") : "";
  if (!providerAccountId || !email || payload.verified !== true) return null;

  const globalName = typeof payload.global_name === "string" ? payload.global_name : "";
  const username = typeof payload.username === "string" ? payload.username : "";
  const displayName = (globalName || username).trim().replace(/\s+/g, " ").slice(0, 60);
  if (displayName.length < 2) return null;

  return { providerAccountId, email, displayName };
}

export function createDiscordConfig(
  environment: Record<string, string | undefined>,
  options: { fetch?: typeof fetch } = {},
): DiscordConfig | null {
  const clientId = environment.DISCORD_CLIENT_ID?.trim() ?? "";
  const clientSecret = environment.DISCORD_CLIENT_SECRET?.trim() ?? "";
  const appOrigin = environment.APP_ORIGIN?.trim() ?? "";
  if (!clientId || !clientSecret || !appOrigin) return null;

  return {
    clientId,
    clientSecret,
    redirectUri: new URL("/api/auth/discord/callback", appOrigin).href,
    fetch: options.fetch,
  };
}
