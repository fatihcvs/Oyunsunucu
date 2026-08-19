export type ServerStatus =
  | "requested"
  | "provisioning"
  | "deploying"
  | "online"
  | "failed"
  | "suspended"
  | "deleting"
  | "deleted";

export type JobKind =
  | "create_server"
  | "start_server"
  | "stop_server"
  | "restart_server"
  | "delete_server"
  | "apply_settings"
  | "resize_server"
  | "create_backup";

/**
 * Every job kind, as a value.
 *
 * The type alone is erased at runtime, which is how `apply_settings` and
 * `resize_server` reached production while the database still refused them.
 * This list is what the schema test compares the SQL CHECK against.
 */
export const JOB_KINDS = [
  "create_server",
  "start_server",
  "stop_server",
  "restart_server",
  "delete_server",
  "apply_settings",
  "resize_server",
  "create_backup",
] as const satisfies readonly JobKind[];

export type JobStatus = "pending" | "leased" | "succeeded" | "failed" | "dead";

const ALLOWED_SERVER_TRANSITIONS: Record<ServerStatus, readonly ServerStatus[]> = {
  requested: ["provisioning", "failed"],
  provisioning: ["deploying", "failed"],
  deploying: ["online", "failed"],
  online: ["deleting", "suspended", "deploying"],
  // A failed setup can be retried or torn down; it is never silently online.
  failed: ["provisioning", "deleting"],
  suspended: ["online", "deleting"],
  deleting: ["deleted", "failed"],
  deleted: [],
};

export function canServerTransition(from: ServerStatus, to: ServerStatus) {
  return ALLOWED_SERVER_TRANSITIONS[from]?.includes(to) ?? false;
}

/** What the panel's buttons are called, and the job each one queues. */
export const SERVER_COMMANDS = {
  baslat: "start_server",
  durdur: "stop_server",
  "yeniden-baslat": "restart_server",
} as const satisfies Record<string, JobKind>;

export type ServerCommand = keyof typeof SERVER_COMMANDS;

/**
 * Which command a server in this state can actually carry out.
 *
 * Deliberately narrow: a server mid-setup has nothing to stop, and a stopped
 * server has nothing to restart. Refusing here means the customer gets an
 * honest answer instead of a queued job that fails at the provider.
 *
 * `delete_server` is absent on purpose — it is irreversible and there is no
 * backup system to restore from yet, so it stays an operator action.
 */
const COMMANDS_BY_STATUS: Record<ServerStatus, readonly JobKind[]> = {
  requested: [],
  provisioning: [],
  deploying: [],
  online: ["stop_server", "restart_server"],
  failed: [],
  suspended: ["start_server"],
  deleting: [],
  deleted: [],
};

export function isServerCommand(value: unknown): value is ServerCommand {
  return typeof value === "string" && value in SERVER_COMMANDS;
}

export function canCommandServer(status: ServerStatus, command: ServerCommand) {
  return COMMANDS_BY_STATUS[status]?.includes(SERVER_COMMANDS[command]) ?? false;
}

/** How long a worker owns a claimed job before another may take it over. */
export const JOB_LEASE_MS = 5 * 60_000;
export const JOB_MAX_ATTEMPTS = 5;

/**
 * Exponential backoff with a ceiling.
 *
 * A provider outage should not be hammered, but a transient error should be
 * retried soon enough that a customer's server still arrives quickly.
 */
export function retryDelayMs(attempts: number) {
  return Math.min(2 ** Math.max(0, attempts - 1) * 15_000, 10 * 60_000);
}

/**
 * The key that makes an enqueue idempotent.
 *
 * Derived from what the job is about rather than when it was asked for, so a
 * redelivered webhook, a double-clicked button and a worker retry all resolve
 * to the same key and therefore the same single job.
 */
export function jobIdempotencyKey(kind: JobKind, subjectId: string) {
  return `${kind}:${subjectId}`;
}
