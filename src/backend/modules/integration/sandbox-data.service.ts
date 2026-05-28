import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { queryTenantPostgres, isNeonConnected } from '../../shared/database.js';
import { slackUsernameFromRow } from '../../shared/slack-row.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, '..', '..', 'data');

type SandboxTableConfig = {
  tableName: string;
  filename: string;
  insertQuery: string;
  getParams: (row: any, tenantId: string) => any[];
};

/**
 * Calculates a dynamic timestamp offset so that all mock incident dates (May 26, 2026)
 * happen EXACTLY relative to the current actual system time.
 */
function offsetTimestamp(rawTime: string | Date | undefined): string {
  if (!rawTime) return new Date().toISOString();
  const timeMs = new Date(rawTime).getTime();
  if (isNaN(timeMs)) return new Date().toISOString();
  
  // Base date of the SRE mock dataset (May 26, 2026 at 17:00 UTC)
  const baseTime = new Date('2026-05-26T17:00:00Z').getTime();
  const now = Date.now();
  const offset = now - baseTime;
  
  return new Date(timeMs + offset).toISOString();
}

const SANDBOX_TABLES: SandboxTableConfig[] = [
  {
    tableName: 'deployments_history',
    filename: 'deployments_history.jsonl',
    insertQuery:
      'INSERT INTO deployments_history (id, tenant_id, service, version, status, deployed_at, changelog, deployed_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING',
    getParams: (row, tenantId) => [row.id, tenantId, row.service, row.version, row.status, offsetTimestamp(row.deployed_at), row.changelog, row.deployed_by]
  },
  {
    tableName: 'github_builds',
    filename: 'github_builds.jsonl',
    insertQuery:
      'INSERT INTO github_builds (id, tenant_id, workflow_name, commit_sha, branch, status, trigger_time, duration_seconds, error_log, triggered_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING',
    getParams: (row, tenantId) => [row.id, tenantId, row.workflow_name, row.commit_sha, row.branch, row.status, offsetTimestamp(row.trigger_time), row.duration_seconds, row.error_log, row.triggered_by]
  },
  {
    tableName: 'sentry_errors',
    filename: 'sentry_errors.jsonl',
    insertQuery:
      'INSERT INTO sentry_errors (id, tenant_id, issue_id, message, status, level, first_seen, last_seen, count, metadata__culprit, stack_trace) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (id) DO NOTHING',
    getParams: (row, tenantId) => [row.id, tenantId, row.issue_id, row.message, row.status, row.level, offsetTimestamp(row.first_seen), offsetTimestamp(row.last_seen), row.count, row.metadata__culprit, row.stack_trace]
  },
  {
    tableName: 'slack_threads',
    filename: 'slack_threads.jsonl',
    insertQuery:
      'INSERT INTO slack_threads (id, tenant_id, channel, ts, username, text, replies_count, replies) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING',
    getParams: (row, tenantId) => [
      row.id,
      tenantId,
      row.channel,
      offsetTimestamp(row.ts),
      slackUsernameFromRow(row),
      row.text,
      row.replies_count,
      typeof row.replies === 'string' ? row.replies : JSON.stringify(row.replies || [])
    ]
  },
  {
    tableName: 'pagerduty_incidents',
    filename: 'pagerduty_incidents.jsonl',
    insertQuery:
      'INSERT INTO pagerduty_incidents (id, tenant_id, title, status, urgency, created_at, service_name, assignee) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING',
    getParams: (row, tenantId) => [row.id, tenantId, row.title, row.status, row.urgency, offsetTimestamp(row.created_at), row.service_name, row.assignee]
  },
  {
    tableName: 'enterprise_tickets',
    filename: 'enterprise_tickets.jsonl',
    insertQuery:
      'INSERT INTO enterprise_tickets (id, tenant_id, board, title, status, priority, assignee, service, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING',
    getParams: (row, tenantId) => [row.id, tenantId, row.board, row.title, row.status, row.priority, row.assignee, row.service, offsetTimestamp(row.created_at)]
  },
  {
    tableName: 'enterprise_change_requests',
    filename: 'enterprise_change_requests.jsonl',
    insertQuery:
      'INSERT INTO enterprise_change_requests (id, tenant_id, system, service, version, status, requester, scheduled_at, risk_level) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING',
    getParams: (row, tenantId) => [row.id, tenantId, row.system, row.service, row.version, row.status, row.requester, offsetTimestamp(row.scheduled_at), row.risk_level]
  },
  {
    tableName: 'enterprise_knowledge_base',
    filename: 'enterprise_knowledge_base.jsonl',
    insertQuery:
      'INSERT INTO enterprise_knowledge_base (id, tenant_id, platform, title, service, runbook_steps, last_updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING',
    getParams: (row, tenantId) => [row.id, tenantId, row.platform, row.title, row.service, row.runbook_steps, offsetTimestamp(row.last_updated_at)]
  }
];

export const PROVIDER_SANDBOX_TABLE: Record<string, string> = {
  pagerduty: 'pagerduty_incidents',
  sentry: 'sentry_errors',
  github: 'github_builds',
  slack: 'slack_threads',
  jira: 'enterprise_tickets'
};

/** Primary keys are global — scope demo row ids per tenant so each org gets its own copy. */
function scopeRowId(tenantId: string, rawId: string): string {
  const tenantPrefix = tenantId.replace(/-/g, '').slice(0, 8);
  return `${tenantPrefix}-${rawId}`;
}

async function tenantTableHasRows(tenantId: string, tableName: string): Promise<boolean> {
  const rows = await queryTenantPostgres(
    tenantId,
    `SELECT 1 FROM ${tableName} LIMIT 1`
  );
  return rows.length > 0;
}

async function seedTableForTenant(tenantId: string, config: SandboxTableConfig): Promise<number> {
  const filePath = path.join(dataDir, config.filename);
  let fileContent: string;

  try {
    fileContent = await fs.readFile(filePath, 'utf-8');
  } catch {
    console.warn(`⚠️ [Sandbox] Demo file missing: ${config.filename}`);
    return 0;
  }

  const lines = fileContent.split('\n').filter(line => line.trim().length > 0);
  let inserted = 0;

  for (const line of lines) {
    const rowObj = JSON.parse(line);
    const scopedRow = { ...rowObj, id: scopeRowId(tenantId, rowObj.id) };
    const params = config.getParams(scopedRow, tenantId);

    await queryTenantPostgres(tenantId, config.insertQuery, params);
    inserted++;
  }

  return inserted;
}

/**
 * Loads Quest Global demo JSONL datasets into the connecting tenant's RLS scope.
 * Supports force refresh by clearing existing tenant rows before inserting.
 */
export async function provisionSandboxDataForTenant(
  tenantId: string,
  forceRefresh: boolean = false
): Promise<{ tablesSeeded: number; rowsInserted: number }> {
  if (!isNeonConnected()) {
    console.log('ℹ [Sandbox] Neon inactive — demo queries will use local Coral JSONL.');
    return { tablesSeeded: 0, rowsInserted: 0 };
  }

  let tablesSeeded = 0;
  let rowsInserted = 0;

  for (const config of SANDBOX_TABLES) {
    try {
      if (forceRefresh) {
        // Safe relative delete bound strictly to tenant context
        await queryTenantPostgres(tenantId, `DELETE FROM ${config.tableName}`);
      } else {
        const hasRows = await tenantTableHasRows(tenantId, config.tableName);
        if (hasRows) {
          continue;
        }
      }

      const count = await seedTableForTenant(tenantId, config);
      if (count > 0) {
        tablesSeeded++;
        rowsInserted += count;
        console.log(`  ✓ [Sandbox] Seeded ${count} relative-time rows into ${config.tableName} for tenant ${tenantId}`);
      }
    } catch (err: any) {
      if (err.message?.includes('does not exist')) {
        throw new Error(
          `Demo table "${config.tableName}" is missing. Run "pnpm seed" once to create database tables, then retry Sandbox Demo.`
        );
      }
      throw err;
    }
  }

  return { tablesSeeded, rowsInserted };
}

export async function countSandboxRowsForProvider(tenantId: string, provider: string): Promise<number> {
  const tableName = PROVIDER_SANDBOX_TABLE[provider];
  if (!tableName || !isNeonConnected()) {
    return 0;
  }

  const rows = await queryTenantPostgres(
    tenantId,
    `SELECT COUNT(*)::int AS count FROM ${tableName}`
  );
  return rows[0]?.count ?? 0;
}
