import type { AuthEnvironment } from "../../lib/auth-runtime.ts";
import type { AuthRepository } from "../../lib/auth-service.ts";
import {
  PostgresAuthRepository,
  type SqlExecutor,
  type SqlQueryResult,
  type SqlRow,
  type TransactionalSqlExecutor,
} from "./auth-repository.ts";

export type SqlExecutorFactory = (environment: AuthEnvironment) => TransactionalSqlExecutor | null;

type NodePostgresModule = typeof import("./node-pg-executor.ts");

/**
 * One pool per process, created on first use.
 *
 * The import is deferred so the driver is only pulled in on a Node runtime:
 * `pg` opens TCP sockets and cannot load in an edge runtime, and the module
 * must not be evaluated merely because a route imported the composition root.
 */
let databasePromise: Promise<TransactionalSqlExecutor> | null = null;

export type DatabaseTlsMode = "disable" | "require" | "verify";

/**
 * How the connection is protected.
 *
 * `disable` suits a provider's private network, where the traffic never leaves
 * it. `require` encrypts but does not verify the certificate — the default,
 * because managed proxies commonly present a certificate no public root signs.
 * `verify` is the strongest and should be used wherever the provider offers a
 * verifiable chain.
 */
export function databaseTlsMode(environment: AuthEnvironment): DatabaseTlsMode {
  const mode = environment.DATABASE_SSL?.trim().toLowerCase();
  return mode === "disable" || mode === "verify" ? mode : "require";
}

function tlsOptions(mode: DatabaseTlsMode) {
  if (mode === "disable") return undefined;
  return { rejectUnauthorized: mode === "verify" };
}

function connect(connectionString: string, mode: DatabaseTlsMode) {
  databasePromise ??= (import("./node-pg-executor.ts") as Promise<NodePostgresModule>)
    .then(({ createNodePostgresDatabase }) => createNodePostgresDatabase({
      connectionString,
      ssl: tlsOptions(mode),
    }));
  return databasePromise;
}

function isNodeRuntime() {
  return typeof process !== "undefined" && Boolean(process.versions?.node);
}

/**
 * Lazy executor: every call awaits the shared pool.
 *
 * Keeping the factory synchronous lets the composition root stay a plain
 * function while the driver itself is still loaded on demand.
 */
function createLazyExecutor(connectionString: string, mode: DatabaseTlsMode): TransactionalSqlExecutor {
  return {
    async query<Row extends SqlRow = SqlRow>(text: string, values?: readonly unknown[]) {
      const database = await connect(connectionString, mode);
      return database.query<Row>(text, values) as Promise<SqlQueryResult<Row>>;
    },
    async transaction<T>(callback: (transaction: SqlExecutor) => Promise<T>) {
      const database = await connect(connectionString, mode);
      return database.transaction(callback);
    },
  };
}

/**
 * Binds the live PostgreSQL driver.
 *
 * Returns null when there is no usable connection string or the runtime cannot
 * host the driver, so every route answers `AUTH_ADAPTER_NOT_BOUND` instead of
 * pretending an account was created.
 */
export const createSqlExecutor: SqlExecutorFactory = (environment) => {
  const connectionString = environment.DATABASE_URL?.trim();
  if (!connectionString || !isNodeRuntime()) return null;

  return createLazyExecutor(connectionString, databaseTlsMode(environment));
};

export function createAuthRepository(
  environment: AuthEnvironment,
  executorFactory: SqlExecutorFactory = createSqlExecutor,
): AuthRepository | null {
  const executor = executorFactory(environment);
  return executor ? new PostgresAuthRepository(executor) : null;
}
