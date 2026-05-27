import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import { queryTenantPostgres, isNeonConnected } from './shared/database.js';
import { syncIntegrationDataIfLive } from './modules/integration/integration.service.js';
import {
  buildTenantAgentContext,
  filterTablesForTenant,
  DEFAULT_SERVICE_NAMES,
  TenantAgentContext
} from './modules/investigation/tenant-agent-context.js';
import { saveInvestigation } from './modules/investigation/investigation.service.js';
import { getCoralDataFile } from './shared/data-paths.js';
import {
  sanitizeLevels,
  sanitizeServiceNames,
  sanitizeTimestamp,
  toSqlLikeLiteral,
  toSqlLiteral
} from './shared/sql-sanitize.js';

const execAsync = promisify(exec);

export interface TimelineEvent {
  time: string;
  title: string;
  desc: string;
  type: 'alert' | 'deploy' | 'rollback' | 'error' | 'success';
}

export interface RootCause {
  service: string;
  reason: string;
  commit: string;
  author: string;
  resolution: string;
  cabStatus?: string;
  runbook?: string;
  tickets?: { id: string; board: string; title: string; status: string; priority: string }[];
}

export interface AgentResponse {
  answer: string;
  sqlQueries: string[];
  sqlResults: any[];
  timeline: TimelineEvent[];
  rootCause: RootCause;
  coralFeatures: string[];
  queryTimeMs: number;
}

interface ExtractedEntities {
  services: string[];
  statuses: string[];
  levels: string[];
  keywords: string[];
  timeRange: { after?: string; before?: string };
}

interface QueryPlan {
  intent: 'incident_investigation' | 'deployment_check' | 'build_status' | 'error_analysis' | 'slack_review' | 'correlation' | 'general' | 'enterprise_audit';
  tables: string[];
  entities: ExtractedEntities;
}

const SERVICE_NAMES = DEFAULT_SERVICE_NAMES;
const STATUS_KEYWORDS = ['failed', 'failure', 'success', 'triggered', 'acknowledged', 'resolved', 'unresolved'];
const ERROR_KEYWORDS = ['error', 'exception', 'timeout', 'crash', 'fatal', 'bug', 'broken', '5xx', '502', '503', '500'];
const DEPLOY_KEYWORDS = ['deploy', 'deployment', 'release', 'rollback', 'revert', 'version', 'shipped', 'pushed'];
const INCIDENT_KEYWORDS = ['incident', 'alert', 'pagerduty', 'page', 'outage', 'downtime', 'sla', 'breach'];
const BUILD_KEYWORDS = ['build', 'ci', 'pipeline', 'github', 'actions', 'workflow', 'test', 'jest'];
const SLACK_KEYWORDS = ['slack', 'message', 'thread', 'conversation', 'discussed', 'said', 'team'];
const ENTERPRISE_KEYWORDS = ['jira', 'confluence', 'azure', 'boards', 'clickup', 'linear', 'cab', 'servicenow', 'runbook', 'knowledge', 'ticket', 'change', 'approval'];

export function parseCoralTable(asciiTable: string): any[] {
  const lines = asciiTable.split('\n');
  const borderRegex = /^\+[-+]*\+$/;

  const dataLines = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (borderRegex.test(trimmed)) return false;
    return true;
  });

  if (dataLines.length < 1) return [];

  const headers = dataLines[0]
    .split('|')
    .map(h => h.trim())
    .filter(h => h.length > 0);

  const results: any[] = [];

  for (let i = 1; i < dataLines.length; i++) {
    const cells = dataLines[i]
      .split('|')
      .map(c => c.trim())
      .filter((_, idx) => idx > 0 && idx <= headers.length);

    if (cells.length === headers.length) {
      const rowObj: any = {};
      headers.forEach((header, idx) => {
        const val = cells[idx];
        if (/^\d+$/.test(val)) {
          rowObj[header] = parseInt(val, 10);
        } else if (/^\d+\.\d+$/.test(val)) {
          rowObj[header] = parseFloat(val);
        } else if (val === 'null' || val === 'NULL') {
          rowObj[header] = null;
        } else {
          rowObj[header] = val;
        }
      });
      results.push(rowObj);
    }
  }

  return results;
}

export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000';

type TableQueryFn = (
  entities: ExtractedEntities,
  tenantId: string
) => Promise<{ sql: string; results: any[] }>;

export async function runCoralQuery(sql: string, tenantId: string): Promise<any[]> {
  const actualTenantId = tenantId;
  if (isNeonConnected() && !/\bcoral\.(columns|tables)\b/i.test(sql)) {
    try {
      // Translate Coral table names (dot) to Postgres table names (underscore)
      let pgSql = sql
        .replace(/\bdeployments\.history\b/g, 'deployments_history')
        .replace(/\bpagerduty\.incidents\b/g, 'pagerduty_incidents')
        .replace(/\bsentry\.errors\b/g, 'sentry_errors')
        .replace(/\bgithub\.builds\b/g, 'github_builds')
        .replace(/\bslack\.threads\b/g, 'slack_threads')
        .replace(/\benterprise\.tickets\b/g, 'enterprise_tickets')
        .replace(/\benterprise\.change_requests\b/g, 'enterprise_change_requests')
        .replace(/\benterprise\.knowledge_base\b/g, 'enterprise_knowledge_base');

      // Map SQL reserved "user" column to Postgres "username" column
      pgSql = pgSql.replace(/\buser\b/g, 'username').replace(/\bt\.user\b/g, 't.username');

      // Live integration synchronization on-demand
      const lowercaseSql = sql.toLowerCase();
      if (lowercaseSql.includes('pagerduty.incidents') || lowercaseSql.includes('pagerduty_incidents')) {
        await syncIntegrationDataIfLive(actualTenantId, 'pagerduty', 'pagerduty_incidents');
      }
      if (lowercaseSql.includes('sentry.errors') || lowercaseSql.includes('sentry_errors')) {
        await syncIntegrationDataIfLive(actualTenantId, 'sentry', 'sentry_errors');
      }
      if (lowercaseSql.includes('github.builds') || lowercaseSql.includes('github_builds')) {
        await syncIntegrationDataIfLive(actualTenantId, 'github', 'github_builds');
      }
      if (lowercaseSql.includes('slack.threads') || lowercaseSql.includes('slack_threads')) {
        await syncIntegrationDataIfLive(actualTenantId, 'slack', 'slack_threads');
      }
      if (lowercaseSql.includes('enterprise.tickets') || lowercaseSql.includes('enterprise_tickets')) {
        await syncIntegrationDataIfLive(actualTenantId, 'jira', 'enterprise_tickets');
      }

      console.log(`[Neon Postgres] [Tenant Scope: ${actualTenantId}] Executing translated SQL: ${pgSql}`);
      const results = await queryTenantPostgres(actualTenantId, pgSql);
      
      // Map username column back to user to maintain frontend compatibility
      return results.map(row => {
        if (row.username !== undefined) {
          const { username, ...rest } = row;
          return { ...rest, user: username };
        }
        return row;
      });
    } catch (err: any) {
      console.warn(`⚠️ [Neon Postgres] Query failed: ${err.message}. Falling back to Coral JSONL.`);
    }
  }

  // Fallback to local Coral JSONL files
  try {
    const escapedSql = sql.replace(/"/g, '\\"');
    const { stdout } = await execAsync(`coral sql --format json "${escapedSql}"`);
    const trimmed = stdout.trim();
    if (!trimmed || trimmed === '[]') return [];
    try {
      return JSON.parse(trimmed);
    } catch {
      return parseCoralTable(stdout);
    }
  } catch (error: any) {
    console.error(`[Coral Query Error] ${error.message}`);
    throw new Error(error.stdout || error.stderr || error.message);
  }
}

function extractEntities(prompt: string, serviceNames: string[] = SERVICE_NAMES): ExtractedEntities {
  const normalized = prompt.toLowerCase();
  const words = normalized.split(/\s+/);

  const services = serviceNames.filter(svc => normalized.includes(svc));

  if (services.length === 0) {
    if (normalized.includes('payment')) services.push('payment-service');
    if (normalized.includes('order')) services.push('order-service');
    if (normalized.includes('gateway') || normalized.includes('api')) services.push('api-gateway');
    if (normalized.includes('user') || normalized.includes('auth')) services.push('user-service');
    if (normalized.includes('notification') || normalized.includes('email')) services.push('notification-service');
  }

  const statuses = STATUS_KEYWORDS.filter(s => normalized.includes(s));
  const levels: string[] = [];
  if (normalized.includes('fatal')) levels.push('fatal');
  if (normalized.includes('error')) levels.push('error');
  if (normalized.includes('warning') || normalized.includes('warn')) levels.push('warning');

  const keywords: string[] = [];
  ERROR_KEYWORDS.forEach(k => { if (normalized.includes(k)) keywords.push(k); });
  DEPLOY_KEYWORDS.forEach(k => { if (normalized.includes(k)) keywords.push(k); });
  INCIDENT_KEYWORDS.forEach(k => { if (normalized.includes(k)) keywords.push(k); });
  BUILD_KEYWORDS.forEach(k => { if (normalized.includes(k)) keywords.push(k); });
  SLACK_KEYWORDS.forEach(k => { if (normalized.includes(k)) keywords.push(k); });

  const timeRange: { after?: string; before?: string } = {};
  const afterMatch = normalized.match(/after\s+(\d{2}:\d{2})/);
  const beforeMatch = normalized.match(/before\s+(\d{2}:\d{2})/);
  if (afterMatch) timeRange.after = `2026-05-26T${afterMatch[1]}:00Z`;
  if (beforeMatch) timeRange.before = `2026-05-26T${beforeMatch[1]}:00Z`;

  if (normalized.includes('today') || normalized.includes('recent') || normalized.includes('latest')) {
    timeRange.after = '2026-05-26T00:00:00Z';
  }

  return {
    services: sanitizeServiceNames(services),
    statuses,
    levels: sanitizeLevels(levels),
    keywords,
    timeRange: {
      after: sanitizeTimestamp(timeRange.after) ?? undefined,
      before: sanitizeTimestamp(timeRange.before) ?? undefined
    }
  };
}

function classifyIntent(prompt: string, entities: ExtractedEntities): QueryPlan['intent'] {
  const normalized = prompt.toLowerCase();
  const hasIncident = INCIDENT_KEYWORDS.some(k => normalized.includes(k));
  const hasDeploy = DEPLOY_KEYWORDS.some(k => normalized.includes(k));
  const hasBuild = BUILD_KEYWORDS.some(k => normalized.includes(k));
  const hasError = ERROR_KEYWORDS.some(k => normalized.includes(k));
  const hasSlack = SLACK_KEYWORDS.some(k => normalized.includes(k));
  const hasEnterprise = ENTERPRISE_KEYWORDS.some(k => normalized.includes(k));

  const hasWhy = /\b(why|what happened|root cause|investigate|cause|diagnose|explain)\b/.test(normalized);
  const hasCorrelate = /\b(correlat|connect|link|relat|cascade|impact)\b/.test(normalized);

  if (hasWhy || hasCorrelate || (hasIncident && hasError) || (hasDeploy && hasError)) {
    return 'incident_investigation';
  }
  if (hasEnterprise) {
    return 'enterprise_audit';
  }
  if (hasSlack && !hasError && !hasIncident) return 'slack_review';
  if (hasBuild && !hasIncident) return 'build_status';
  if (hasDeploy && !hasError && !hasIncident) return 'deployment_check';
  if (hasError && !hasIncident && !hasDeploy) return 'error_analysis';
  if (hasIncident) return 'correlation';
  return 'general';
}

function buildQueryPlan(prompt: string, context?: TenantAgentContext): QueryPlan {
  const serviceNames = context?.serviceNames ?? SERVICE_NAMES;
  const entities = extractEntities(prompt, serviceNames);
  const intent = classifyIntent(prompt, entities);

  const tableMap: Record<QueryPlan['intent'], string[]> = {
    incident_investigation: [
      'deployments.history',
      'pagerduty.incidents',
      'sentry.errors',
      'github.builds',
      'slack.threads',
      'enterprise.tickets',
      'enterprise.change_requests',
      'enterprise.knowledge_base'
    ],
    deployment_check: ['deployments.history', 'github.builds'],
    build_status: ['github.builds', 'sentry.errors'],
    error_analysis: ['sentry.errors', 'pagerduty.incidents'],
    slack_review: ['slack.threads'],
    correlation: ['pagerduty.incidents', 'deployments.history', 'sentry.errors', 'enterprise.change_requests'],
    enterprise_audit: ['enterprise.tickets', 'enterprise.change_requests', 'enterprise.knowledge_base'],
    general: ['deployments.history', 'pagerduty.incidents', 'sentry.errors', 'enterprise.tickets'],
  };

  const allTables = tableMap[intent];
  const tables = context ? filterTablesForTenant(allTables, context) : allTables;

  return { intent, tables, entities };
}

function buildServiceFilter(alias: string, column: string, services: string[]): string {
  const safe = sanitizeServiceNames(services);
  if (safe.length === 0) return '';
  if (safe.length === 1) return `${alias}.${column} = ${toSqlLiteral(safe[0])}`;
  const inClause = safe.map((s) => toSqlLiteral(s)).join(', ');
  return `${alias}.${column} IN (${inClause})`;
}

function buildCulpritLikeFilter(services: string[]): string {
  const safe = sanitizeServiceNames(services);
  if (safe.length === 0) return '';
  const likeConditions = safe.map(
    (s) => `s.metadata__culprit LIKE ${toSqlLikeLiteral(`%${s}%`)}`
  );
  return `(${likeConditions.join(' OR ')})`;
}

function buildTimestampCondition(
  alias: string,
  column: string,
  op: '>' | '<',
  ts: string | undefined
): string {
  const safe = sanitizeTimestamp(ts);
  if (!safe) return '';
  return `${alias}.${column} ${op} ${toSqlLiteral(safe)}`;
}

function buildWhereClause(conditions: string[]): string {
  const filtered = conditions.filter(c => c.length > 0);
  if (filtered.length === 0) return '';
  return `WHERE ${filtered.join(' AND ')}`;
}

async function queryDeployments(entities: ExtractedEntities, tenantId: string): Promise<{ sql: string; results: any[] }> {
  const conditions: string[] = [];
  const svcFilter = buildServiceFilter('d', 'service', entities.services);
  if (svcFilter) conditions.push(svcFilter);
  const afterDeploy = buildTimestampCondition('d', 'deployed_at', '>', entities.timeRange.after);
  const beforeDeploy = buildTimestampCondition('d', 'deployed_at', '<', entities.timeRange.before);
  if (afterDeploy) conditions.push(afterDeploy);
  if (beforeDeploy) conditions.push(beforeDeploy);

  const where = buildWhereClause(conditions);
  const sql = `SELECT d.id, d.service, d.version, d.status, d.deployed_at, d.changelog, d.deployed_by FROM deployments.history d ${where} ORDER BY d.deployed_at DESC LIMIT 15`.trim();
  const results = await runCoralQuery(sql, tenantId);
  return { sql, results };
}

async function queryIncidents(entities: ExtractedEntities, tenantId: string): Promise<{ sql: string; results: any[] }> {
  const conditions: string[] = [];
  const svcFilter = buildServiceFilter('p', 'service_name', entities.services);
  if (svcFilter) conditions.push(svcFilter);
  if (entities.statuses.includes('triggered')) conditions.push(`p.status = 'triggered'`);
  if (entities.statuses.includes('resolved')) conditions.push(`p.status = 'resolved'`);
  const afterIncident = buildTimestampCondition('p', 'created_at', '>', entities.timeRange.after);
  if (afterIncident) conditions.push(afterIncident);

  const where = buildWhereClause(conditions);
  const sql = `SELECT p.id, p.title, p.status, p.urgency, p.created_at, p.service_name, p.assignee FROM pagerduty.incidents p ${where} ORDER BY p.created_at DESC LIMIT 15`.trim();
  const results = await runCoralQuery(sql, tenantId);
  return { sql, results };
}

async function queryErrors(entities: ExtractedEntities, tenantId: string): Promise<{ sql: string; results: any[] }> {
  const conditions: string[] = [];
  const culpritFilter = buildCulpritLikeFilter(entities.services);
  if (culpritFilter) conditions.push(culpritFilter);
  if (entities.levels.length > 0) {
    const inClause = entities.levels.map((l) => toSqlLiteral(l)).join(', ');
    conditions.push(`s.level IN (${inClause})`);
  }
  if (entities.statuses.includes('unresolved')) conditions.push(`s.status = 'unresolved'`);
  if (entities.statuses.includes('resolved')) conditions.push(`s.status = 'resolved'`);
  const afterError = buildTimestampCondition('s', 'first_seen', '>', entities.timeRange.after);
  if (afterError) conditions.push(afterError);

  const where = buildWhereClause(conditions);
  const sql = `SELECT s.id, s.issue_id, s.message, s.level, s.status, s.first_seen, s.last_seen, s.count, s.metadata__culprit FROM sentry.errors s ${where} ORDER BY s.count DESC LIMIT 15`.trim();
  const results = await runCoralQuery(sql, tenantId);
  return { sql, results };
}

async function queryBuilds(entities: ExtractedEntities, tenantId: string): Promise<{ sql: string; results: any[] }> {
  const conditions: string[] = [];
  if (entities.statuses.includes('failed')) conditions.push(`b.status = 'failed'`);
  const afterBuild = buildTimestampCondition('b', 'trigger_time', '>', entities.timeRange.after);
  if (afterBuild) conditions.push(afterBuild);

  const where = buildWhereClause(conditions);
  const sql = `SELECT b.id, b.workflow_name, b.commit_sha, b.branch, b.status, b.trigger_time, b.duration_seconds, b.error_log, b.triggered_by FROM github.builds b ${where} ORDER BY b.trigger_time DESC LIMIT 15`.trim();
  const results = await runCoralQuery(sql, tenantId);
  return { sql, results };
}

async function querySlack(entities: ExtractedEntities, tenantId: string): Promise<{ sql: string; results: any[] }> {
  const conditions: string[] = [];
  const afterSlack = buildTimestampCondition('t', 'ts', '>', entities.timeRange.after);
  const beforeSlack = buildTimestampCondition('t', 'ts', '<', entities.timeRange.before);
  if (afterSlack) conditions.push(afterSlack);
  if (beforeSlack) conditions.push(beforeSlack);

  const where = buildWhereClause(conditions);
  const sql = `SELECT t.id, t.channel, t.ts, t.user, t.text, t.replies_count FROM slack.threads t ${where} ORDER BY t.ts ASC LIMIT 20`.trim();
  const results = await runCoralQuery(sql, tenantId);
  return { sql, results };
}

async function queryEnterpriseTickets(entities: ExtractedEntities, tenantId: string): Promise<{ sql: string; results: any[] }> {
  const conditions: string[] = [];
  const svcFilter = buildServiceFilter('t', 'service', entities.services);
  if (svcFilter) conditions.push(svcFilter);
  const where = buildWhereClause(conditions);
  const sql = `SELECT t.id, t.board, t.title, t.status, t.priority, t.assignee, t.service, t.created_at FROM enterprise.tickets t ${where} ORDER BY t.created_at DESC LIMIT 15`.trim();
  const results = await runCoralQuery(sql, tenantId);
  return { sql, results };
}

async function queryEnterpriseChangeRequests(entities: ExtractedEntities, tenantId: string): Promise<{ sql: string; results: any[] }> {
  const conditions: string[] = [];
  const svcFilter = buildServiceFilter('c', 'service', entities.services);
  if (svcFilter) conditions.push(svcFilter);
  const where = buildWhereClause(conditions);
  const sql = `SELECT c.id, c.system, c.service, c.version, c.status, c.requester, c.scheduled_at, c.risk_level FROM enterprise.change_requests c ${where} ORDER BY c.scheduled_at DESC LIMIT 15`.trim();
  const results = await runCoralQuery(sql, tenantId);
  return { sql, results };
}

async function queryEnterpriseKnowledgeBase(entities: ExtractedEntities, tenantId: string): Promise<{ sql: string; results: any[] }> {
  const conditions: string[] = [];
  const svcFilter = buildServiceFilter('k', 'service', entities.services);
  if (svcFilter) conditions.push(svcFilter);
  const where = buildWhereClause(conditions);
  const sql = `SELECT k.id, k.platform, k.title, k.service, k.runbook_steps, k.last_updated_at FROM enterprise.knowledge_base k ${where} LIMIT 5`.trim();
  const results = await runCoralQuery(sql, tenantId);
  return { sql, results };
}

async function queryCorrelation(entities: ExtractedEntities, tenantId: string): Promise<{ sql: string; results: any[] }> {
  const conditions: string[] = [];
  const svcFilter = buildServiceFilter('d', 'service', entities.services);
  if (svcFilter) conditions.push(svcFilter);
  const afterCorr = buildTimestampCondition('d', 'deployed_at', '>', entities.timeRange.after);
  if (afterCorr) conditions.push(afterCorr);

  const defaultAfter = buildTimestampCondition('d', 'deployed_at', '>', '2026-05-26T16:00:00Z');
  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : `WHERE ${defaultAfter}`;
  const sql = `SELECT d.service, d.version, d.deployed_at, d.changelog, p.title AS incident_title, p.urgency, p.created_at AS incident_at FROM deployments.history d JOIN pagerduty.incidents p ON d.service = p.service_name ${where} ORDER BY d.deployed_at DESC LIMIT 15`.trim();
  const results = await runCoralQuery(sql, tenantId);
  return { sql, results };
}

function buildTimeline(allResults: any[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const seen = new Set<string>();

  for (const row of allResults) {
    // Skip correlation join rows in timeline to prevent duplicates and undefined IDs
    if (row.incident_title !== undefined) continue;

    const time = row.deployed_at || row.created_at || row.trigger_time || row.first_seen || row.ts || '';
    if (!time) continue;
    const timeStr = typeof time === 'string' ? time : time.toISOString();
    const shortTime = timeStr.replace('2026-05-26T', '').replace('Z', '');
    const key = `${shortTime}-${row.id || row.issue_id || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (row.deployed_at) {
      const isRollback =
        (row.changelog || '').toLowerCase().includes('rollback') ||
        (row.changelog || '').toLowerCase().includes('revert');
      events.push({
        time: shortTime,
        title: isRollback
          ? `${row.service} ${row.version} rolled back`
          : `${row.service} ${row.version} deployed`,
        desc: row.changelog || '',
        type: isRollback ? 'rollback' : 'deploy',
      });
    } else if (row.created_at && row.urgency) {
      events.push({
        time: shortTime,
        title: `PagerDuty: ${row.title || row.id}`,
        desc: `Urgency: ${row.urgency} | Assigned: ${row.assignee || 'unassigned'}`,
        type: 'alert',
      });
    } else if (row.trigger_time && row.workflow_name) {
      events.push({
        time: shortTime,
        title: `${row.workflow_name} — ${row.status}`,
        desc: row.status === 'failed' ? (row.error_log || '').substring(0, 120) : `Completed in ${row.duration_seconds}s`,
        type: row.status === 'failed' ? 'error' : 'success',
      });
    } else if (row.first_seen && row.message) {
      events.push({
        time: shortTime,
        title: `Sentry [${row.level}]: ${row.issue_id}`,
        desc: (row.message || '').substring(0, 120),
        type: row.level === 'fatal' ? 'alert' : 'error',
      });
    } else if (row.ts && row.text) {
      events.push({
        time: shortTime,
        title: `Slack — ${row.user}`,
        desc: (row.text || '').substring(0, 150),
        type: 'success',
      });
    }
  }

  events.sort((a, b) => a.time.localeCompare(b.time));
  return events;
}

function analyzeRootCause(allResults: any[]): RootCause {
  // Filter out correlation join rows to prevent duplicate counting or property issues
  const cleanResults = allResults.filter(r => r.incident_title === undefined);
  const fatalErrors = cleanResults.filter(r => r.level === 'fatal' || r.level === 'error');
  const deployments = cleanResults.filter(r => r.deployed_at);
  const highUrgency = cleanResults.filter(r => r.urgency === 'high');
  const failedBuilds = cleanResults.filter(r => r.status === 'failed' && r.workflow_name);
  const tickets = cleanResults.filter(r => r.board && r.title);
  const changeRequests = cleanResults.filter(r => r.system === 'ServiceNow' && r.service);
  const runbooks = allResults.filter(r => r.runbook_steps && r.service);

  const errorCounts: Record<string, number> = {};
  for (const err of fatalErrors) {
    const culprit = err.metadata__culprit || 'unknown';
    const service = culprit.split('/')[0] || 'unknown';
    errorCounts[service] = (errorCounts[service] || 0) + (err.count || 1);
  }

  let topService = 'unknown';
  let topCount = 0;
  for (const [svc, count] of Object.entries(errorCounts)) {
    if (count > topCount) {
      topService = svc;
      topCount = count;
    }
  }

  const suspectDeploy = deployments.find(d =>
    d.service === topService &&
    !((d.changelog || '').toLowerCase().includes('rollback'))
  );

  const rollbackDeploy = deployments.find(d =>
    (d.changelog || '').toLowerCase().includes('rollback') ||
    (d.changelog || '').toLowerCase().includes('revert')
  );

  const topError = fatalErrors.sort((a, b) => (b.count || 0) - (a.count || 0))[0];

  // Lookup CAB status for the suspect deployment version
  let cabStatus = 'N/A';
  if (suspectDeploy) {
    const cab = changeRequests.find(c => c.service === suspectDeploy.service && c.version === suspectDeploy.version);
    if (cab) {
      cabStatus = cab.status;
    } else {
      cabStatus = 'UNAUTHORIZED';
    }
  }

  // Lookup matching runbook
  let runbookText = '';
  const matchingRunbook = runbooks.find(r => r.service === topService);
  if (matchingRunbook) {
    runbookText = matchingRunbook.runbook_steps;
  }

  // Filter linked tickets
  const linkedTickets = tickets
    .filter(t => t.service === topService)
    .map(t => ({
      id: t.id,
      board: t.board,
      title: t.title,
      status: t.status,
      priority: t.priority
    }));

  if (suspectDeploy && topError) {
    let reasonText = `Deployment of ${suspectDeploy.service} ${suspectDeploy.version} at ${suspectDeploy.deployed_at} introduced a regression. ${topError.message}. This error occurred ${topError.count} times and cascaded to dependent services.`;
    if (cabStatus === 'Rejected_CAB' || cabStatus === 'UNAUTHORIZED') {
      reasonText += ` WARNING: This deployment was ${cabStatus.toUpperCase()}! No approved Change Request found in ServiceNow.`;
    }

    return {
      service: topService,
      reason: reasonText,
      commit: suspectDeploy.changelog || 'unknown',
      author: suspectDeploy.deployed_by || 'unknown',
      resolution: rollbackDeploy
        ? `Rolled back to ${rollbackDeploy.version} at ${rollbackDeploy.deployed_at}. Incident resolved.`
        : 'Rollback recommended. Fix the interface-breaking change and add integration tests before redeploying.',
      cabStatus,
      runbook: runbookText,
      tickets: linkedTickets
    };
  }

  if (highUrgency.length > 0) {
    const incident = highUrgency[0];
    const svc = incident.service_name || topService;
    const finalRunbook = runbooks.find(r => r.service === svc)?.runbook_steps || '';
    return {
      service: svc,
      reason: incident.title || 'High-urgency incident detected across services.',
      commit: suspectDeploy?.changelog || 'N/A',
      author: incident.assignee || 'unassigned',
      resolution: 'Investigate the correlated deployment and Sentry errors. Consider rollback if error rate remains elevated.',
      cabStatus: 'N/A',
      runbook: finalRunbook,
      tickets: tickets.filter(t => t.service === svc).map(t => ({ id: t.id, board: t.board, title: t.title, status: t.status, priority: t.priority }))
    };
  }

  if (failedBuilds.length > 0) {
    const build = failedBuilds[0];
    return {
      service: (build.workflow_name || '').replace('CI Pipeline — ', '').replace('Deploy Production — ', ''),
      reason: `CI build ${build.id} failed on branch ${build.branch}. ${(build.error_log || '').substring(0, 200)}`,
      commit: build.commit_sha || 'unknown',
      author: build.triggered_by || 'unknown',
      resolution: 'Fix the failing tests and ensure deploy workflows are gated on CI success.',
      cabStatus: 'N/A',
    };
  }

  return {
    service: 'Multiple Services',
    reason: 'No single root cause identified. Review the timeline and correlated data for patterns.',
    commit: 'N/A',
    author: 'N/A',
    resolution: 'Run a deeper investigation across all data sources.',
    cabStatus: 'N/A',
  };
}

function synthesizeAnswer(plan: QueryPlan, allResults: any[], rootCause: RootCause, timeline: TimelineEvent[]): string {
  const totalResults = allResults.length;
  const serviceList = plan.entities.services.length > 0 ? plan.entities.services.join(', ') : 'all services';

  switch (plan.intent) {
    case 'incident_investigation': {
      const errorResults = allResults.filter(r => r.level === 'fatal' || r.level === 'error');
      const incidentResults = allResults.filter(r => r.urgency === 'high');
      const deployResults = allResults.filter(r => r.deployed_at);
      return [
        `**Incident Investigation for ${serviceList}**\n`,
        `Analyzed ${totalResults} records across deployments, PagerDuty incidents, Sentry errors, CI builds, and Slack conversations.\n`,
        `**Key Findings:**`,
        `- ${incidentResults.length} PagerDuty incidents (${incidentResults.filter(r => r.urgency === 'high').length} high-urgency)`,
        `- ${errorResults.length} Sentry errors with a combined ${errorResults.reduce((sum, r) => sum + (r.count || 0), 0)} occurrences`,
        `- ${deployResults.length} deployments in the investigation window`,
        `\n**Root Cause:** ${rootCause.reason}`,
        `\n**Resolution:** ${rootCause.resolution}`,
      ].join('\n');
    }

    case 'deployment_check': {
      const deploys = allResults.filter(r => r.deployed_at);
      return [
        `**Deployment Report for ${serviceList}**\n`,
        `Found ${deploys.length} deployments. ${deploys.filter(r => r.status === 'success').length} successful, ${deploys.filter(r => r.status !== 'success').length} failed.`,
        deploys.map(d => `- **${d.service} ${d.version}** at ${d.deployed_at} — ${d.changelog}`).join('\n'),
      ].join('\n');
    }

    case 'build_status': {
      const builds = allResults.filter(r => r.workflow_name);
      const failed = builds.filter(r => r.status === 'failed');
      return [
        `**CI Build Status Report**\n`,
        `Found ${builds.length} builds. ${failed.length} failed.`,
        failed.length > 0 ? `\n**Failed Builds:**` : '',
        ...failed.map(b => `- **${b.id}** (${b.workflow_name}) on \`${b.branch}\` at ${b.trigger_time}\n  Error: ${(b.error_log || '').substring(0, 150)}`),
      ].filter(Boolean).join('\n');
    }

    case 'error_analysis': {
      const errors = allResults.filter(r => r.message && r.level);
      return [
        `**Sentry Error Analysis for ${serviceList}**\n`,
        `Found ${errors.length} errors. Total occurrences: ${errors.reduce((sum, r) => sum + (r.count || 0), 0)}.`,
        errors.map(e => `- **[${e.level}] ${e.issue_id}**: ${e.message} (${e.count} occurrences)\n  Culprit: \`${e.metadata__culprit}\``).join('\n'),
      ].join('\n');
    }

    case 'slack_review': {
      const messages = allResults.filter(r => r.text && r.user);
      return [
        `**Slack Incident Thread Review**\n`,
        `Found ${messages.length} messages in #incidents channel.`,
        messages.map(m => `- **${m.user}** (${m.ts}): ${(m.text || '').substring(0, 200)}`).join('\n'),
      ].join('\n');
    }

    case 'correlation': {
      return [
        `**Cross-Source Correlation for ${serviceList}**\n`,
        `Correlated ${totalResults} records across deployments, incidents, and errors.`,
        `\n**Root Cause:** ${rootCause.reason}`,
        `\n**Resolution:** ${rootCause.resolution}`,
      ].join('\n');
    }

    case 'enterprise_audit': {
      const ticketsCount = allResults.filter(r => r.board && r.title).length;
      const cabCount = allResults.filter(r => r.system && r.risk_level).length;
      const kbCount = allResults.filter(r => r.runbook_steps).length;
      return [
        `**Enterprise Integration Audit for ${serviceList}**\n`,
        `Successfully queried corporate ticketing and knowledge systems:`,
        `- Found ${ticketsCount} tickets on boards (Jira, Azure Boards, ClickUp, Linear)`,
        `- Audited ${cabCount} Change Requests in ServiceNow / Change Advisory Board`,
        `- Retransmitted ${kbCount} troubleshooting runbooks from Confluence/Notion`,
        `\n**Active Resolution Playbook:**`,
        rootCause.runbook ? rootCause.runbook : `No playbook matching ${serviceList} was found in Confluence.`
      ].join('\n');
    }

    default: {
      return [
        `**General SRE Overview**\n`,
        `Queried ${totalResults} records across ${plan.tables.length} data sources for ${serviceList}.`,
        timeline.length > 0 ? `\nTimeline contains ${timeline.length} events.` : '',
        `\n**Root Cause Analysis:** ${rootCause.reason}`,
      ].filter(Boolean).join('\n');
    }
  }
}


async function postSlackAlert(text: string) {
  try {
    const filePath = getCoralDataFile('slack_threads.jsonl');
    const content = await fs.readFile(filePath, 'utf-8');
    if (content.includes('slack-alert-101')) return; // already posted
    
    const newAlert = {
      id: 'slack-alert-101',
      channel: '#incidents',
      ts: '2026-05-26T17:15:00Z',
      user: 'Coral SRE Bot',
      text: text,
      replies_count: 0,
      replies: '[]'
    };
    await fs.appendFile(filePath, '\n' + JSON.stringify(newAlert) + '\n');
    console.log('[Agent] Posted SRE Bot Alert to Slack threads.');
  } catch (e: any) {
    console.error('[Agent] Failed to post Slack alert:', e.message);
  }
}

export async function handleSreAgentQuery(
  prompt: string,
  tenantId?: string,
  options?: { userId?: string; source?: string }
): Promise<AgentResponse & { investigationId?: string }> {
  const scopeTenantId = tenantId || DEFAULT_TENANT_ID;
  const t0 = Date.now();

  const context = tenantId ? await buildTenantAgentContext(tenantId) : undefined;
  const plan = buildQueryPlan(prompt, context);

  if (plan.tables.length === 0) {
    const missingHint = context
      ? ' Connect the required integrations in Integration Hub (Sandbox Demo works instantly).'
      : '';
    throw new Error(`No data sources available for this investigation.${missingHint}`);
  }

  console.log(`[Agent] Intent: ${plan.intent} | Tables: ${plan.tables.join(', ')} | Services: ${plan.entities.services.join(', ') || 'all'}`);

  const coralFeatures: string[] = ['sql-interface'];
  const allSqlQueries: string[] = [];
  const allResults: any[] = [];

  const queryExecutors: Record<string, TableQueryFn> = {
    'deployments.history': queryDeployments,
    'pagerduty.incidents': queryIncidents,
    'sentry.errors': queryErrors,
    'github.builds': queryBuilds,
    'slack.threads': querySlack,
    'enterprise.tickets': queryEnterpriseTickets,
    'enterprise.change_requests': queryEnterpriseChangeRequests,
    'enterprise.knowledge_base': queryEnterpriseKnowledgeBase,
  };

  if (plan.tables.length > 1) coralFeatures.push('multi-source-query');

  for (const table of plan.tables) {
    const executor = queryExecutors[table];
    if (!executor) continue;

    try {
      const { sql, results } = await executor(plan.entities, scopeTenantId);
      allSqlQueries.push(sql);
      allResults.push(...results);
      console.log(`[Agent] ${table}: ${results.length} rows returned`);
    } catch (err: any) {
      console.error(`[Agent] Failed querying ${table}: ${err.message}`);
    }
  }

  if (plan.intent === 'incident_investigation' || plan.intent === 'correlation') {
    coralFeatures.push('cross-source-join');
    try {
      const { sql, results } = await queryCorrelation(plan.entities, scopeTenantId);
      allSqlQueries.push(sql);
      allResults.push(...results);
      console.log(`[Agent] Cross-source correlation: ${results.length} rows returned`);
    } catch (err: any) {
      console.error(`[Agent] Correlation query failed: ${err.message}`);
    }
  }

  if (allSqlQueries.length > 1) coralFeatures.push('caching');
  coralFeatures.push('custom-source-specs');

  const timeline = buildTimeline(allResults);
  const rootCause = analyzeRootCause(allResults);
  const answer = synthesizeAnswer(plan, allResults, rootCause, timeline);
  
  // Post alert to Slack if this was a real outage investigation
  if (plan.intent === 'incident_investigation' && rootCause.service && rootCause.cabStatus && rootCause.cabStatus !== 'N/A') {
    const isApproved = rootCause.cabStatus.toLowerCase().includes('approved');
    const alertMessage = `🚨 *[SRE Incident Resolution]* Identified outage culprit: *${rootCause.service}*.\n` +
      `- *Root Cause*: ${rootCause.reason.split('.')[0]}.\n` +
      `- *ServiceNow Audit*: Change state is ${rootCause.cabStatus.toUpperCase()}${isApproved ? ' (Authorized)' : ' (WARNING: UNAUTHORIZED CHANGE!)'}.\n` +
      `- *Resolution*: ${rootCause.resolution}`;
    await postSlackAlert(alertMessage);
  }

  const queryTimeMs = Date.now() - t0;

  const response: AgentResponse = {
    answer,
    sqlQueries: allSqlQueries,
    sqlResults: allResults,
    timeline,
    rootCause,
    coralFeatures,
    queryTimeMs,
  };

  let investigationId: string | undefined;
  if (tenantId) {
    try {
      const saved = await saveInvestigation(
        tenantId,
        options?.userId,
        prompt,
        plan.intent,
        response,
        options?.source || 'dashboard'
      );
      investigationId = saved.id;
    } catch (err: any) {
      console.error(`[Agent] Failed to persist investigation history: ${err.message}`);
    }
  }

  return { ...response, investigationId };
}