import { queryControlPlanePostgres } from '../../shared/database.js';

export interface InvestigationPayload {
  answer: string;
  sqlQueries: string[];
  timeline: unknown[];
  rootCause: unknown;
  coralFeatures: string[];
  queryTimeMs: number;
}

export async function initInvestigationsSchema() {
  await queryControlPlanePostgres(`
    CREATE TABLE IF NOT EXISTS investigations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id),
      query TEXT NOT NULL,
      intent VARCHAR(50),
      answer TEXT,
      sql_queries TEXT[],
      timeline JSONB,
      root_cause JSONB,
      coral_features TEXT[],
      duration_ms INTEGER,
      source VARCHAR(20) DEFAULT 'dashboard',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await queryControlPlanePostgres(`
    CREATE INDEX IF NOT EXISTS idx_investigations_tenant_created
    ON investigations(tenant_id, created_at DESC);
  `);
}

export async function saveInvestigation(
  tenantId: string,
  userId: string | undefined,
  prompt: string,
  intent: string,
  response: InvestigationPayload,
  source: string = 'dashboard'
) {
  const rows = await queryControlPlanePostgres(
    `INSERT INTO investigations
      (tenant_id, user_id, query, intent, answer, sql_queries, timeline, root_cause, coral_features, duration_ms, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, created_at`,
    [
      tenantId,
      userId || null,
      prompt,
      intent,
      response.answer,
      response.sqlQueries,
      JSON.stringify(response.timeline),
      JSON.stringify(response.rootCause),
      response.coralFeatures,
      response.queryTimeMs,
      source
    ]
  );
  return rows[0];
}

export async function listInvestigations(tenantId: string, limit = 50) {
  return queryControlPlanePostgres(
    `SELECT id, query, intent, answer, duration_ms, source, created_at
     FROM investigations
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [tenantId, limit]
  );
}

export async function getInvestigationById(tenantId: string, investigationId: string) {
  const rows = await queryControlPlanePostgres(
    `SELECT id, tenant_id, user_id, query, intent, answer, sql_queries, timeline, root_cause, coral_features, duration_ms, source, created_at
     FROM investigations
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, investigationId]
  );
  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    ...row,
    timeline: typeof row.timeline === 'string' ? JSON.parse(row.timeline) : row.timeline,
    root_cause: typeof row.root_cause === 'string' ? JSON.parse(row.root_cause) : row.root_cause
  };
}
