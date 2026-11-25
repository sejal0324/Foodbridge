import pg from 'pg';
import type { Logger } from '../config/logger.js';

// Type parsing: counts (int8) and numerics become JS numbers (values in this
// application stay far below 2^53); plain DATE columns stay ISO strings so no
// timezone shift can occur.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number.parseInt(v, 10));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number.parseFloat(v));
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export type Row = pg.QueryResultRow;

/** Anything that can run a query: the pool or a transaction client. */
export interface Queryable {
  query<R extends Row = Row>(text: string, values?: readonly unknown[]): Promise<pg.QueryResult<R>>;
}

function wrap(client: pg.PoolClient): Queryable {
  return {
    query: <R extends Row = Row>(text: string, values?: readonly unknown[]) =>
      client.query<R>(text, values as unknown[] | undefined),
  };
}

export class Database implements Queryable {
  readonly pool: pg.Pool;

  constructor(connectionString: string, poolMax: number, private readonly logger: Logger) {
    this.pool = new pg.Pool({
      connectionString,
      max: poolMax,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
      application_name: 'foodbridge-backend',
    });
    // An idle client error must not crash the process; the pool replaces it.
    this.pool.on('error', (err) => this.logger.error({ err }, 'idle database client error'));
  }

  query<R extends Row = Row>(text: string, values?: readonly unknown[]): Promise<pg.QueryResult<R>> {
    return this.pool.query<R>(text, values as unknown[] | undefined);
  }

  /** Runs `fn` inside BEGIN/COMMIT; any thrown error rolls the transaction back. */
  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(wrap(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        this.logger.error({ err: rollbackErr }, 'rollback failed');
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** Returns the first row or undefined. */
export async function one<R extends Row>(q: Queryable, text: string, values?: readonly unknown[]): Promise<R | undefined> {
  const res = await q.query<R>(text, values);
  return res.rows[0];
}

/** Returns all rows. */
export async function many<R extends Row>(q: Queryable, text: string, values?: readonly unknown[]): Promise<R[]> {
  const res = await q.query<R>(text, values);
  return res.rows;
}
