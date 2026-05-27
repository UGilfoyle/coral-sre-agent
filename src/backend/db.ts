import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load the .env file from project root
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const connectionString = process.env.DATABASE_URL;

let pool: pg.Pool | null = null;
let isNeonActive = false;

if (connectionString) {
  try {
    pool = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false // Required for serverless Neon Postgres ssl mode
      },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
    isNeonActive = true;
    console.log("🐚 [Neon Postgres] Initialized secure Postgres client pool.");
  } catch (e: any) {
    console.error("❌ [Neon Postgres] Failed to initialize connection pool:", e.message);
  }
} else {
  console.log("⚠️ [Neon Postgres] No DATABASE_URL found. Gracefully falling back to local Coral JSONL mode.");
}

/**
 * Execute a secure parameterized SQL query directly on the Neon Serverless Postgres instance.
 * Automatically throws an error if pool is inactive so the caller can fall back to local Coral.
 */
export async function queryPostgres(sql: string, params: any[] = []): Promise<any[]> {
  if (!pool || !isNeonActive) {
    throw new Error("Neon connection pool is inactive. Fallback required.");
  }

  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return res.rows;
  } finally {
    client.release();
  }
}

/**
 * Verifies if the cloud database connection is fully active and accessible.
 */
export async function testConnection(): Promise<boolean> {
  if (!pool) return false;
  try {
    const rows = await queryPostgres("SELECT NOW() as t");
    return rows.length > 0;
  } catch (err: any) {
    console.error("❌ [Neon Postgres] Database connection verification failed:", err.message);
    return false;
  }
}

export function isNeonConnected(): boolean {
  return isNeonActive && pool !== null;
}
