import express from 'express';
import cors from 'cors';
import { runCoralQuery, handleSreAgentQuery } from './agent.js';
import { testConnection } from './shared/database.js';
import { authenticate, requireRole } from './modules/auth/auth.middleware.js';
import { authenticateSsoUser } from './modules/auth/auth.service.js';
import { rateLimit } from './modules/auth/rate-limit.middleware.js';
import { sqlGuard } from './modules/auth/sql-guard.middleware.js';
import { createApiKey, listApiKeys, revokeApiKey, initApiKeysSchema } from './modules/auth/api-key.service.js';
import { getTenantContext, listTenantUsers, inviteUserToTenant } from './modules/tenant/tenant.service.js';
import {
  initInvestigationsSchema,
  listInvestigations,
  getInvestigationById
} from './modules/investigation/investigation.service.js';
import { 
  initIntegrationsSchema, 
  listIntegrations, 
  connectIntegration, 
  disconnectIntegration, 
  checkIntegrationHealth 
} from './modules/integration/integration.service.js';

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Incoming Request Logging Middleware for Dev Telemetry
app.use((req, res, next) => {
  console.log(`📡 [BFF Incoming] ${req.method} ${req.path} | Original: ${req.originalUrl}`);
  next();
});

// Global Authentication Scope Middleware
app.use(authenticate);

/* ───── AUTH & SSO ENDPOINTS ───── */

/**
 * Mock SSO Login Route (Simulates Google/GitHub OAuth identity provider exchange)
 * Takes email and name, auto-provisions a secure workspace (tenant) and issues JWT.
 */
app.post('/api/auth/login', async (req, res) => {
  const { email, name } = req.body;
  if (!email || !name) {
    return res.status(400).json({ error: "Email and Name are required in request body" });
  }

  try {
    const authResult = await authenticateSsoUser(email, name, 'google-mock', `g-mock-${email}`);
    res.json(authResult);
  } catch (error: any) {
    console.error(`❌ [SSO Login] Mock login transaction failed: ${error.message}`);
    res.status(500).json({ error: `SSO authentication failed: ${error.message}` });
  }
});

/**
 * Retrieves the current session's profile context along with the active workspace details.
 */
app.get('/api/v1/auth/me', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized. Active session not found." });
  }

  try {
    const tenantContext = await getTenantContext(req.user.tenantId);
    res.json({
      user: req.user,
      tenant: tenantContext
    });
  } catch (error: any) {
    res.status(500).json({ error: `Failed to load user session context: ${error.message}` });
  }
});

/* ───── TENANT & TEAM ENDPOINTS ───── */

app.get('/api/v1/tenants/users', async (req, res) => {
  if (!req.tenantId) {
    return res.status(400).json({ error: "Active tenant scope not resolved." });
  }

  try {
    const team = await listTenantUsers(req.tenantId);
    res.json({ team });
  } catch (error: any) {
    res.status(500).json({ error: `Failed to retrieve tenant users: ${error.message}` });
  }
});

app.post('/api/v1/tenants/invite', async (req, res) => {
  if (!req.tenantId) {
    return res.status(400).json({ error: "Active tenant scope not resolved." });
  }

  const { email, name, role } = req.body;
  if (!email || !name) {
    return res.status(400).json({ error: "Email and Name are required to send an invitation." });
  }

  try {
    const invite = await inviteUserToTenant(req.tenantId, email, name, role || 'member');
    res.json({ success: true, invite });
  } catch (error: any) {
    res.status(500).json({ error: `Failed to invite user: ${error.message}` });
  }
});

/* ───── INTEGRATIONS PROXY ENDPOINTS ───── */

app.get('/api/v1/integrations', async (req, res) => {
  if (!req.tenantId) {
    return res.status(400).json({ error: "Active tenant scope not resolved." });
  }

  try {
    const integrations = await listIntegrations(req.tenantId);
    res.json({ integrations });
  } catch (error: any) {
    res.status(500).json({ error: `Failed to list integrations: ${error.message}` });
  }
});

app.post('/api/v1/integrations/:provider', async (req, res) => {
  if (!req.tenantId) {
    return res.status(400).json({ error: "Active tenant scope not resolved." });
  }

  const { provider } = req.params;
  const { mode, credentials, config } = req.body;

  if (!mode || (mode !== 'live' && mode !== 'simulated')) {
    return res.status(400).json({ error: "Connection mode must be either 'live' or 'simulated'." });
  }

  try {
    const result = await connectIntegration(req.tenantId, provider, mode, credentials, config);
    // Run diagnostics immediately to verify health status
    const health = await checkIntegrationHealth(req.tenantId, provider);
    res.json({ ...result, health });
  } catch (error: any) {
    res.status(500).json({ error: `Failed to connect integration: ${error.message}` });
  }
});

app.delete('/api/v1/integrations/:provider', async (req, res) => {
  if (!req.tenantId) {
    return res.status(400).json({ error: "Active tenant scope not resolved." });
  }

  const { provider } = req.params;

  try {
    const result = await disconnectIntegration(req.tenantId, provider);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: `Failed to disconnect integration: ${error.message}` });
  }
});

app.get('/api/v1/integrations/:provider/health', async (req, res) => {
  if (!req.tenantId) {
    return res.status(400).json({ error: "Active tenant scope not resolved." });
  }

  const { provider } = req.params;

  try {
    const health = await checkIntegrationHealth(req.tenantId, provider);
    res.json(health);
  } catch (error: any) {
    res.status(500).json({ error: `Failed to check integration health: ${error.message}` });
  }
});

/* ───── INVESTIGATION HISTORY ENDPOINTS ───── */

app.get('/api/v1/investigations', async (req, res) => {
  if (!req.tenantId) {
    return res.status(400).json({ error: 'Active tenant scope not resolved.' });
  }

  try {
    const investigations = await listInvestigations(req.tenantId);
    res.json({ investigations });
  } catch (error: any) {
    res.status(500).json({ error: `Failed to list investigations: ${error.message}` });
  }
});

app.get('/api/v1/investigations/:id', async (req, res) => {
  if (!req.tenantId) {
    return res.status(400).json({ error: 'Active tenant scope not resolved.' });
  }

  try {
    const investigation = await getInvestigationById(req.tenantId, req.params.id);
    if (!investigation) {
      return res.status(404).json({ error: 'Investigation not found.' });
    }
    res.json({ investigation });
  } catch (error: any) {
    res.status(500).json({ error: `Failed to retrieve investigation: ${error.message}` });
  }
});

app.post('/api/v1/investigate', requireRole(['owner', 'admin', 'member']), rateLimit('investigate'), async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Investigation query is required in request body' });
  }
  if (!req.tenantId) {
    return res.status(400).json({ error: 'Active tenant scope not resolved.' });
  }

  try {
    const source = req.headers['x-api-key'] ? 'api' : 'dashboard';
    const agentResponse = await handleSreAgentQuery(prompt, req.tenantId, {
      userId: req.user?.userId,
      source
    });
    res.json(agentResponse);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Investigation failed';
    res.status(error instanceof Error && message.includes('No data sources') ? 422 : 500).json({ error: message });
  }
});

/* ───── API KEY MANAGEMENT ENDPOINTS ───── */

app.get('/api/v1/api-keys', requireRole(['owner', 'admin']), async (req, res) => {
  if (!req.tenantId) {
    return res.status(400).json({ error: 'Active tenant scope not resolved.' });
  }

  try {
    const keys = await listApiKeys(req.tenantId);
    res.json({ keys });
  } catch (error: any) {
    res.status(500).json({ error: `Failed to list API keys: ${error.message}` });
  }
});

app.post('/api/v1/api-keys', requireRole(['owner', 'admin']), async (req, res) => {
  if (!req.tenantId || !req.user?.userId) {
    return res.status(400).json({ error: 'Active tenant scope not resolved.' });
  }

  const { name, scopes, rateLimit: keyRateLimit } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ error: 'API key name is required.' });
  }

  try {
    const created = await createApiKey(req.tenantId, req.user.userId, name, scopes, keyRateLimit);
    res.status(201).json({
      key: {
        id: created.id,
        name: created.name,
        keyPrefix: created.key_prefix,
        scopes: created.scopes,
        rateLimit: created.rate_limit,
        createdAt: created.created_at
      },
      rawKey: created.rawKey,
      warning: 'Store this key securely. It will not be shown again.'
    });
  } catch (error: any) {
    res.status(500).json({ error: `Failed to create API key: ${error.message}` });
  }
});

app.delete('/api/v1/api-keys/:id', requireRole(['owner', 'admin']), async (req, res) => {
  if (!req.tenantId) {
    return res.status(400).json({ error: 'Active tenant scope not resolved.' });
  }

  try {
    const result = await revokeApiKey(req.tenantId, req.params.id);
    if (!result.success) {
      return res.status(404).json({ error: 'API key not found or already revoked.' });
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: `Failed to revoke API key: ${error.message}` });
  }
});

/* ───── SECURED SRE ENDPOINTS (COPIED & INTEGRATED WITH AUTH) ───── */

app.post('/api/query', requireRole(['owner', 'admin', 'member']), rateLimit('query'), sqlGuard, async (req, res) => {
  const { sql } = req.body;
  if (!sql) {
    return res.status(400).json({ error: 'SQL query is required in request body' });
  }

  const scopeTenantId = req.tenantId || 'global-demo';
  console.log(`[Coral AI Bot] [Tenant Scope: ${scopeTenantId}] SQL Query: ${sql}`);
  try {
    const results = await runCoralQuery(sql, scopeTenantId);
    res.json({ results });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal query execution error';
    console.error(`[Coral AI Bot] Query failed: ${message}`);
    res.status(500).json({ error: message });
  }
});

app.post('/api/agent', requireRole(['owner', 'admin', 'member']), rateLimit('investigate'), async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Agent prompt is required in request body' });
  }

  const scopeTenantId = req.tenantId || 'global-demo';
  console.log(`[Coral AI Bot] [Tenant Scope: ${scopeTenantId}] Agent prompt: ${prompt}`);
  try {
    const source = req.headers['x-api-key'] ? 'api' : 'dashboard';
    const agentResponse = await handleSreAgentQuery(prompt, scopeTenantId, {
      userId: req.user?.userId,
      source
    });
    res.json(agentResponse);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Agent processing error';
    console.error(`[Coral AI Bot] Agent failed: ${message}`);
    const status = error instanceof Error && message.includes('No data sources') ? 422 : 500;
    res.status(status).json({ error: message });
  }
});

app.get('/api/schema', async (req, res) => {
  const scopeTenantId = req.tenantId || 'global-demo';
  try {
    const columns = await runCoralQuery("SELECT schema_name, table_name, column_name, data_type FROM coral.columns", scopeTenantId);
    res.json({ tables: columns });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve schema';
    console.error(`[Coral AI Bot] Schema failed: ${message}`);
    res.status(500).json({ error: message });
  }
});

app.get('/api/sources', async (_req, res) => {
  try {
    const { stdout } = await execAsync('coral source list');
    res.json({ output: stdout.trim() });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve sources';
    console.error(`[Coral AI Bot] Sources failed: ${message}`);
    res.status(500).json({ error: message });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'healthy', engine: 'Coral AI Bot — SRE SaaS Platform' });
});

app.listen(port, async () => {
  console.log(`🐚 Coral AI Bot — SRE Multi-Tenant SaaS Platform`);
  console.log(`   Server running on http://localhost:${port}`);
  console.log(`   POST /auth/login  — Mock SSO authentication portal`);
  console.log(`   GET  /v1/auth/me  — Current session context resolution`);
  console.log(`   POST /api/agent   — Secured incident investigation`);
  console.log(`   POST /api/query   — Secured Coral SQL execution`);
  console.log(`   GET  /api/health  — Health check`);
  
  const dbConnected = await testConnection();
  if (dbConnected) {
    console.log(`   🟢 Database: Connected securely to Neon Multi-Tenant Postgres Cloud`);
    await initIntegrationsSchema();
    await initInvestigationsSchema();
    await initApiKeysSchema();
    console.log(`   ✓ Control plane schemas verified (integrations, investigations, api_keys)`);
  } else {
    console.log(`   ⚠️  Database: Connection failed or inactive. Falling back to local Coral JSONL.`);
  }
});
