import { Pool, type PoolClient, type PoolConfig } from "pg";
import type {
  SqlExecutor,
  SqlQueryResult,
  SqlRow,
  TransactionalSqlExecutor,
} from "./auth-repository.ts";

export type NodePostgresOptions = {
  connectionString: string;
  max?: number;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
  ssl?: PoolConfig["ssl"];
};

export type NodePostgresDatabase = TransactionalSqlExecutor & {
  /** Runs the callback on one checked-out connection, for session-scoped work such as advisory locks. */
  session<T>(callback: (session: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

function wrapClient(client: PoolClient): SqlExecutor {
  return {
    async query<Row extends SqlRow = SqlRow>(text: string, values: readonly unknown[] = []) {
      const result = await client.query(text, [...values]);
      return { rows: result.rows as Row[], rowCount: result.rowCount } satisfies SqlQueryResult<Row>;
    },
  };
}

/**
 * node-postgres adapter for Node-side tooling: migrations and integration tests.
 *
 * The Worker runtime binds its own executor; keeping this one separate means the
 * repository contract stays driver-agnostic and no Node-only module is pulled
 * into the edge bundle.
 */
export function createNodePostgresDatabase(options: NodePostgresOptions): NodePostgresDatabase {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 5,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 10_000,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 10_000,
    ssl: options.ssl,
  });

  return {
    async query<Row extends SqlRow = SqlRow>(text: string, values: readonly unknown[] = []) {
      const result = await pool.query(text, [...values]);
      return { rows: result.rows as Row[], rowCount: result.rowCount } satisfies SqlQueryResult<Row>;
    },

    async transaction<T>(callback: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const value = await callback(wrapClient(client));
        await client.query("COMMIT");
        return value;
      } catch (error) {
        // A failed rollback must not hide the error that caused it.
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async session<T>(callback: (session: SqlExecutor) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        return await callback(wrapClient(client));
      } finally {
        client.release();
      }
    },

    async close() {
      await pool.end();
    },
  };
}
