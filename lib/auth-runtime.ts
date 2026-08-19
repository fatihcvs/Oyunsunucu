export type AuthEnvironment = Record<string, string | undefined>;

export type AuthRuntimeReadiness = {
  state: "ready" | "configuration_required";
  ready: boolean;
  checks: {
    database: boolean;
    sessionSecret: boolean;
    appOrigin: boolean;
    emailDelivery: boolean;
    discordOAuth: boolean;
    magicLink: boolean;
    discord: boolean;
  };
  missing: string[];
};

const REQUIRED_ENVIRONMENT_NAMES = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "APP_ORIGIN",
  "EMAIL_FROM",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
] as const;

function valueOf(environment: AuthEnvironment, name: string) {
  const value = environment[name];
  return typeof value === "string" ? value.trim() : "";
}

function isPostgresUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "postgres:" || url.protocol === "postgresql:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isEmailAddress(value: string) {
  if ([...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  })) return false;
  const branded = value.match(/^[^<>]{1,80}<([^<>]+)>$/);
  const address = (branded?.[1] ?? value).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) && address.length <= 254;
}

function hasMinimumSecretEntropy(value: string) {
  return new TextEncoder().encode(value).byteLength >= 32;
}

/** Links and cookies are only safe on a bare HTTPS origin, so the flow cannot start without one. */
export function isDeliverableAppOrigin(value: string) {
  try {
    const url = new URL(value);
    if (url.pathname !== "/" || url.search || url.hash) return false;
    return url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function getAuthRuntimeReadiness(environment: AuthEnvironment): AuthRuntimeReadiness {
  const database = isPostgresUrl(valueOf(environment, "DATABASE_URL"));
  const sessionSecret = hasMinimumSecretEntropy(valueOf(environment, "AUTH_SECRET"));
  const appOrigin = isDeliverableAppOrigin(valueOf(environment, "APP_ORIGIN"));
  const emailDelivery = isEmailAddress(valueOf(environment, "EMAIL_FROM")) && (
    valueOf(environment, "RESEND_API_KEY").length >= 12 ||
    valueOf(environment, "POSTMARK_SERVER_TOKEN").length >= 12
  );
  const discordOAuth = valueOf(environment, "DISCORD_CLIENT_ID").length > 0 &&
    valueOf(environment, "DISCORD_CLIENT_SECRET").length >= 12;
  const magicLink = database && sessionSecret && appOrigin && emailDelivery;
  const discord = database && sessionSecret && appOrigin && discordOAuth;
  const ready = magicLink || discord;

  const missing: string[] = REQUIRED_ENVIRONMENT_NAMES.filter((name) => !valueOf(environment, name));
  if (!valueOf(environment, "RESEND_API_KEY") && !valueOf(environment, "POSTMARK_SERVER_TOKEN")) {
    missing.push("RESEND_API_KEY_OR_POSTMARK_SERVER_TOKEN");
  }

  return {
    state: ready ? "ready" : "configuration_required",
    ready,
    checks: { database, sessionSecret, appOrigin, emailDelivery, discordOAuth, magicLink, discord },
    missing,
  };
}

export function publicAuthRuntimeStatus(environment: AuthEnvironment) {
  const readiness = getAuthRuntimeReadiness(environment);
  return {
    state: readiness.state,
    ready: readiness.ready,
    checks: readiness.checks,
    missing: readiness.missing,
  };
}
