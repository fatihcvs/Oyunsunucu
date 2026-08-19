import { createMagicLinkMailer } from "../infra/email/magic-link-mailer.ts";
import { createDiscordConfig, type DiscordConfig } from "../infra/oauth/discord.ts";
import { createAuthRepository } from "../infra/postgres/driver-binding.ts";
import { getAuthRuntimeReadiness, type AuthEnvironment } from "./auth-runtime.ts";
import {
  createAuthService,
  type AuthRepository,
  type AuthService,
  type MagicLinkMailer,
} from "./auth-service.ts";

export type AuthCompositionOverrides = {
  service?: AuthService;
  repository?: AuthRepository | null;
  mailer?: MagicLinkMailer | null;
  discord?: DiscordConfig | null;
  now?: () => Date;
  onOperationalError?: (error: unknown) => void;
};

export type AuthResolution =
  | { status: "not_configured"; missing: string[] }
  | { status: "adapter_not_bound" }
  | { status: "ready"; service: AuthService };

/**
 * Builds the live authentication service from the runtime environment.
 *
 * The three outcomes stay distinct so the product never claims more than it can
 * do: environment incomplete, storage driver unbound, or genuinely live. Either
 * sign-in method is enough to be live; the service refuses the method whose
 * provider is missing rather than pretending it works.
 */
export function resolveAuthService(
  environment: AuthEnvironment,
  overrides: AuthCompositionOverrides = {},
): AuthResolution {
  if (overrides.service) return { status: "ready", service: overrides.service };

  const readiness = getAuthRuntimeReadiness(environment);
  if (!readiness.ready) return { status: "not_configured", missing: readiness.missing };

  // `in` rather than `??`: an explicit null means "deliberately absent", which a
  // nullish fallback would silently replace with the real adapter.
  const repository = "repository" in overrides
    ? overrides.repository
    : createAuthRepository(environment);
  const mailer = !readiness.checks.magicLink
    ? null
    : "mailer" in overrides ? overrides.mailer ?? null : createMagicLinkMailer(environment);
  const discord = !readiness.checks.discord
    ? null
    : "discord" in overrides ? overrides.discord ?? null : createDiscordConfig(environment);

  if (!repository || (!mailer && !discord)) return { status: "adapter_not_bound" };

  return {
    status: "ready",
    service: createAuthService({
      repository,
      mailer,
      discord,
      appOrigin: String(environment.APP_ORIGIN),
      rateLimitSecret: String(environment.AUTH_SECRET),
      now: overrides.now,
      onOperationalError: overrides.onOperationalError,
    }),
  };
}

/** Which of the three foundations a session check cannot do without. */
const SESSION_REQUIREMENTS = [
  ["database", "DATABASE_URL"],
  ["sessionSecret", "AUTH_SECRET"],
  ["appOrigin", "APP_ORIGIN"],
] as const;

/**
 * The identity service for callers that need no delivery channel.
 *
 * Starting a magic-link sign-in needs a way to deliver it; proving who you
 * already are — with a session cookie or with a password — does not. Requiring a
 * mail provider here would take a customer's own servers away from them the
 * moment email delivery is switched off, which is exactly the state a closed
 * beta runs in.
 *
 * The service is built with no sign-in method bound, so a magic-link or Discord
 * call through it fails loudly rather than silently half-working.
 */
export function resolveSessionAuthService(
  environment: AuthEnvironment,
  overrides: AuthCompositionOverrides = {},
): AuthResolution {
  if (overrides.service) return { status: "ready", service: overrides.service };

  const { checks } = getAuthRuntimeReadiness(environment);
  const missing = SESSION_REQUIREMENTS
    .filter(([check]) => !checks[check])
    .map(([, name]) => name);
  if (missing.length > 0) return { status: "not_configured", missing };

  const repository = "repository" in overrides
    ? overrides.repository
    : createAuthRepository(environment);
  if (!repository) return { status: "adapter_not_bound" };

  return {
    status: "ready",
    service: createAuthService({
      repository,
      mailer: null,
      discord: null,
      appOrigin: String(environment.APP_ORIGIN),
      rateLimitSecret: String(environment.AUTH_SECRET),
      now: overrides.now,
      onOperationalError: overrides.onOperationalError,
    }),
  };
}
