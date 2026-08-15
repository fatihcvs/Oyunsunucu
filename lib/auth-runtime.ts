export type AuthEnvironment = Record<string, string | undefined>;

export type AuthRuntimeReadiness = {
  state: "ready" | "configuration_required";
  ready: boolean;
  checks: {
    database: boolean;
    sessionSecret: boolean;
    emailDelivery: boolean;
    discordOAuth: boolean;
    magicLink: boolean;
    discord: boolean;
  };
  missing: string[];
};

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

export function getAuthRuntimeReadiness(environment: AuthEnvironment): AuthRuntimeReadiness {
  const database = isPostgresUrl(valueOf(environment, "DATABASE_URL"));
  const sessionSecret = hasMinimumSecretEntropy(valueOf(environment, "AUTH_SECRET"));
  const emailSender = isEmailAddress(valueOf(environment, "EMAIL_FROM"));
  const emailApiKey = valueOf(environment, "RESEND_API_KEY").length >= 12 ||
    valueOf(environment, "POSTMARK_SERVER_TOKEN").length >= 12;
  const emailDelivery = emailSender && emailApiKey;
  const discordOAuth = valueOf(environment, "DISCORD_CLIENT_ID").length > 0 &&
    valueOf(environment, "DISCORD_CLIENT_SECRET").length >= 12;
  const magicLink = database && sessionSecret && emailDelivery;
  const discord = database && sessionSecret && discordOAuth;
  const ready = magicLink || discord;

  // Giriş için e-posta veya Discord yollarından biri yeterlidir. Bu yüzden bir
  // sağlayıcı tamamlandığında diğerinin değişkenleri eksik olarak raporlanmaz.
  const missing: string[] = [];
  if (!database) missing.push("DATABASE_URL");
  if (!sessionSecret) missing.push("AUTH_SECRET");
  if (!emailDelivery && !discordOAuth) {
    if (!emailSender) missing.push("EMAIL_FROM");
    if (!emailApiKey) missing.push("RESEND_API_KEY_OR_POSTMARK_SERVER_TOKEN");
    if (!valueOf(environment, "DISCORD_CLIENT_ID")) missing.push("DISCORD_CLIENT_ID");
    if (!valueOf(environment, "DISCORD_CLIENT_SECRET")) missing.push("DISCORD_CLIENT_SECRET");
  }

  return {
    state: ready ? "ready" : "configuration_required",
    ready,
    checks: { database, sessionSecret, emailDelivery, discordOAuth, magicLink, discord },
    missing,
  };
}

export type PublicAuthRuntimeStatus = {
  state: "adapter_required" | "configuration_required";
  live: boolean;
  checks: AuthRuntimeReadiness["checks"] & { postgresAdapter: boolean };
  missing: string[];
};

/**
 * `/api/auth/status` gövdesinin tek kaynağıdır. Yalnızca boolean hazırlık
 * sinyalleri ve eksik değişken adları döner; hiçbir secret değeri sızmaz.
 */
export function publicAuthRuntimeStatus(environment: AuthEnvironment): PublicAuthRuntimeStatus {
  const readiness = getAuthRuntimeReadiness(environment);
  // Sürücü adaptörü yayın ortamına bağlanana kadar canlı giriş kapalıdır.
  const postgresAdapter = false;

  return {
    state: readiness.ready ? "adapter_required" : "configuration_required",
    live: readiness.ready && postgresAdapter,
    checks: { ...readiness.checks, postgresAdapter },
    missing: readiness.missing,
  };
}
