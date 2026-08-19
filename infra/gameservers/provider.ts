import type { GameRuntime } from "./runtime-catalog.ts";

/**
 * Provider-independent game server contract.
 *
 * Nothing above this file knows whether a server runs on Railway, on a
 * container host, or somewhere else. That boundary is what lets the second
 * provider arrive in Faz 8 without touching orders, the panel or the schema.
 */
export type ServerSpec = {
  serverId: string;
  name: string;
  runtime: GameRuntime;
  memoryMb: number;
  storageGb: number;
  regionId: string;
  /** Customer-chosen runtime settings, already validated against the game catalogue. */
  settings?: Record<string, string | number | boolean>;
};

export type ProviderResourceRef = {
  kind: "service" | "volume" | "proxy" | "container";
  id: string;
};

export type ProvisionedServer = {
  resources: ProviderResourceRef[];
  connection: { host: string; port: number } | null;
};

export interface GameServerProvider {
  readonly name: string;
  createServer(spec: ServerSpec): Promise<ProvisionedServer>;
  startServer(serverId: string): Promise<void>;
  stopServer(serverId: string): Promise<void>;
  restartServer(serverId: string): Promise<void>;
  /**
   * Writes the settings into the running server and restarts it.
   *
   * Takes the whole spec rather than a diff: the runtime reads its
   * configuration at boot, so every apply is a full statement of what the
   * server should be, and a retried job converges on the same state.
   */
  applySettings(spec: ServerSpec): Promise<void>;
  /**
   * Moves the server onto a different resource size.
   *
   * Takes the whole spec for the same reason applySettings does: the runtime
   * derives its heap from the plan at boot, so a resize is a full statement of
   * what the server should be rather than a delta.
   */
  resizeServer(spec: ServerSpec): Promise<void>;
  deleteServer(serverId: string): Promise<void>;
  getConnectionInfo(serverId: string): Promise<{ host: string; port: number } | null>;
}

/** Carries the failing operation and whether another attempt could succeed. */
export class ProviderError extends Error {
  readonly operation: string;
  readonly retryable: boolean;

  constructor(operation: string, message: string, retryable = true) {
    super(message);
    this.name = "ProviderError";
    this.operation = operation;
    this.retryable = retryable;
  }
}
