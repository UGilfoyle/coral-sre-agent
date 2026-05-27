import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load the .env file from project root
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const connectionString = process.env.DATABASE_URL;

let pool: pg.Pool | null = null;
let isNeonActive = false;

if (connectionString) {
  try {
    pool = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false
      },
      max: 15,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
    isNeonActive = true;
    console.log("🐚 [Neon Multi-Tenant DB] Initialized secure control plane Postgres connection pool.");
  } catch (e: any) {
    console.error("❌ [Neon Multi-Tenant DB] Failed to initialize connection pool:", e.message);
  }
} else {
  console.log("⚠️ [Neon Multi-Tenant DB] No DATABASE_URL found. Running with local fallback.");
}

/**
 * Execute a query within a specific tenant context to enforce Row-Level Security (RLS) policies.
 * Wraps the query inside a transaction, setting the local 'app.tenant_id' context.
 */
export async function queryTenantPostgres(tenantId: string, sql: string, params: any[] = []): Promise<any[]> {
  if (!pool || !isNeonActive) {
    throw new Error("Neon Postgres pool is inactive. Fallback to local files required.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Inject the tenant_id scope into the transaction context for RLS enforcement
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const res = await client.query(sql, params);
    await client.query("COMMIT");
    return res.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Execute a system control-plane query (e.g. looking up tenants, validating user logins)
 * that is not bound by a specific tenant's RLS policy.
 */
export async function queryControlPlanePostgres(sql: string, params: any[] = []): Promise<any[]> {
  if (!pool || !isNeonActive) {
    throw new Error("Neon Postgres pool is inactive. Fallback required.");
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
 * Check DB health status
 */
export async function testConnection(): Promise<boolean> {
  if (!pool) return false;
  try {
    const rows = await queryControlPlanePostgres("SELECT NOW() as t");
    return rows.length > 0;
  } catch (err: any) {
    console.error("❌ [Neon Postgres] Connection check failed:", err.message);
    return false;
  }
}

export function isNeonConnected(): boolean {
  return isNeonActive && pool !== null;
}
