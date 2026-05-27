import { queryControlPlanePostgres } from '../../shared/database.js';
import { generateApiKey } from './auth.service.js';

const ALLOWED_SCOPES = ['read', 'investigate', 'query'] as const;
export type ApiKeyScope = (typeof ALLOWED_SCOPES)[number];

export async function initApiKeysSchema() {
  await queryControlPlanePostgres(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      created_by UUID REFERENCES users(id),
      name VARCHAR(255) NOT NULL,
      key_prefix VARCHAR(16) NOT NULL,
      key_hash VARCHAR(128) NOT NULL,
      scopes TEXT[] DEFAULT '{read,investigate,query}',
      rate_limit INTEGER DEFAULT 100,
      last_used_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await queryControlPlanePostgres(`
    CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);
  `);
  await queryControlPlanePostgres(`
    ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS rate_limit INTEGER DEFAULT 100;
  `);
}

function normalizeScopes(scopes?: string[]): ApiKeyScope[] {
  if (!scopes?.length) return ['read', 'investigate', 'query'];
  const filtered = scopes.filter((s): s is ApiKeyScope =>
    (ALLOWED_SCOPES as readonly string[]).includes(s)
  );
  return filtered.length ? filtered : ['read'];
}

export async function createApiKey(
  tenantId: string,
  createdBy: string,
  name: string,
  scopes?: string[],
  rateLimit = 100
) {
  if (!name?.trim()) {
    throw new Error('API key name is required.');
  }

  const { rawKey, keyPrefix, keyHash } = generateApiKey();
  const finalScopes = normalizeScopes(scopes);

  const rows = await queryControlPlanePostgres(
    `INSERT INTO api_keys (tenant_id, created_by, name, key_prefix, key_hash, scopes, rate_limit)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, key_prefix, scopes, rate_limit, created_at`,
    [tenantId, createdBy, name.trim(), keyPrefix, keyHash, finalScopes, rateLimit]
  );

  return {
    ...rows[0],
    rawKey
  };
}

export async function listApiKeys(tenantId: string) {
  return queryControlPlanePostgres(
    `SELECT id, name, key_prefix, scopes, rate_limit, last_used_at, expires_at, revoked_at, created_at
     FROM api_keys
     WHERE tenant_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC`,
    [tenantId]
  );
}

export async function revokeApiKey(tenantId: string, keyId: string) {
  const rows = await queryControlPlanePostgres(
    `UPDATE api_keys SET revoked_at = NOW()
     WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL
     RETURNING id`,
    [tenantId, keyId]
  );
  return { success: rows.length > 0 };
}
