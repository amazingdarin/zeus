import pg from "pg";
import pgvector from "pgvector/pg";

const { Pool } = pg;

const databaseConnectTimeoutMs = Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 5000);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://zeus@localhost:5432/zeus",
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: Number.isFinite(databaseConnectTimeoutMs) ? databaseConnectTimeoutMs : 5000,
});

let initialized = false;

export const initPool = async (): Promise<void> => {
  if (initialized) return;
  const client = await pool.connect();
  try {
    await pgvector.registerTypes(client);
    initialized = true;
  } finally {
    client.release();
  }
};

export const query = async <T extends pg.QueryResultRow = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> => {
  return pool.query<T>(text, params);
};

export const getClient = async (): Promise<pg.PoolClient> => {
  return pool.connect();
};

export const closePool = async (): Promise<void> => {
  await pool.end();
};

export { pool };
