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
