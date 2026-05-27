import fs from 'fs';
import path from 'path';
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

// Load environment variables from .env
dotenv.config({ path: path.join(projectRoot, '.env') });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("❌ No DATABASE_URL found in .env. Seeding aborted.");
  process.exit(1);
}

const dataDir = path.join(projectRoot, 'src', 'backend', 'data');

/** JSONL/Coral use `user`; Postgres column is `username`. Live adapter rows may use `username` only. */
function slackUsernameFromRow(row) {
  return row.user ?? row.username ?? null;
}

// Default Seed Tenant details
const SEED_TENANT_ID = '00000000-0000-0000-0000-000000000000';
const SEED_USER_ID = '11111111-1111-1111-1111-111111111111';

// SRE Data Tables with tenant_id RLS support
const filesToTableMap = {
  'deployments_history.jsonl': {
    tableName: 'deployments_history',
    schema: `
      id VARCHAR(50) PRIMARY KEY,
      tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
      service VARCHAR(100),
      version VARCHAR(50),
      status VARCHAR(50),
      deployed_at TIMESTAMP,
      changelog TEXT,
      deployed_by VARCHAR(100)
    `,
    insertQuery: 'INSERT INTO deployments_history (id, tenant_id, service, version, status, deployed_at, changelog, deployed_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING',
    getParams: (row, tenantId) => [row.id, tenantId, row.service, row.version, row.status, row.deployed_at, row.changelog, row.deployed_by]
  },
  'github_builds.jsonl': {
    tableName: 'github_builds',
    schema: `
      id VARCHAR(50) PRIMARY KEY,
      tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
      workflow_name VARCHAR(150),
      commit_sha VARCHAR(100),
      branch VARCHAR(100),
      status VARCHAR(50),
      trigger_time TIMESTAMP,
      duration_seconds INTEGER,
      error_log TEXT,
      triggered_by VARCHAR(100)
    `,
    insertQuery: 'INSERT INTO github_builds (id, tenant_id, workflow_name, commit_sha, branch, status, trigger_time, duration_seconds, error_log, triggered_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING',
    getParams: (row, tenantId) => [row.id, tenantId, row.workflow_name, row.commit_sha, row.branch, row.status, row.trigger_time, row.duration_seconds, row.error_log, row.triggered_by]
  },
  'sentry_errors.jsonl': {
    tableName: 'sentry_errors',
    schema: `
      id VARCHAR(50) PRIMARY KEY,
      tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
      issue_id VARCHAR(50),
      message TEXT,
      status VARCHAR(50),
      level VARCHAR(50),
      first_seen TIMESTAMP,
      last_seen TIMESTAMP,
      count INTEGER,
      metadata__culprit TEXT,
      stack_trace TEXT
    `,
    insertQuery: 'INSERT INTO sentry_errors (id, tenant_id, issue_id, message, status, level, first_seen, last_seen, count, metadata__culprit, stack_trace) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (id) DO NOTHING',
    getParams: (row, tenantId) => [row.id, tenantId, row.issue_id, row.message, row.status, row.level, row.first_seen, row.last_seen, row.count, row.metadata__culprit, row.stack_trace]
  },
  'slack_threads.jsonl': {
    tableName: 'slack_threads',
    schema: `
      id VARCHAR(50) PRIMARY KEY,
      tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
      channel VARCHAR(100),
      ts TIMESTAMP,
      username VARCHAR(100),
      text TEXT,
      replies_count INTEGER,
      replies TEXT
    `,
    insertQuery: 'INSERT INTO slack_threads (id, tenant_id, channel, ts, username, text, replies_count, replies) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING',
    getParams: (row, tenantId) => [row.id, tenantId, row.channel, row.ts, slackUsernameFromRow(row), row.text, row.replies_count, typeof row.replies === 'string' ? row.replies : JSON.stringify(row.replies || [])]
  },
  'pagerduty_incidents.jsonl': {
    tableName: 'pagerduty_incidents',
    schema: `
      id VARCHAR(50) PRIMARY KEY,
      tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
      title TEXT,
      status VARCHAR(50),
      urgency VARCHAR(50),
      created_at TIMESTAMP,
      service_name VARCHAR(100),
      assignee VARCHAR(100)
    `,
    insertQuery: 'INSERT INTO pagerduty_incidents (id, tenant_id, title, status, urgency, created_at, service_name, assignee) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING',
    getParams: (row, tenantId) => [row.id, tenantId, row.title, row.status, row.urgency, row.created_at, row.service_name, row.assignee]
  },
  'enterprise_tickets.jsonl': {
    tableName: 'enterprise_tickets',
    schema: `
      id VARCHAR(50) PRIMARY KEY,
      tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
      board VARCHAR(100),
      title TEXT,
      status VARCHAR(50),
      priority VARCHAR(50),
      assignee VARCHAR(100),
      service VARCHAR(100),
      created_at TIMESTAMP
    `,
    insertQuery: 'INSERT INTO enterprise_tickets (id, tenant_id, board, title, status, priority, assignee, service, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING',
    getParams: (row, tenantId) => [row.id, tenantId, row.board, row.title, row.status, row.priority, row.assignee, row.service, row.created_at]
  },
  'enterprise_change_requests.jsonl': {
    tableName: 'enterprise_change_requests',
    schema: `
      id VARCHAR(50) PRIMARY KEY,
      tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
      system VARCHAR(100),
      service VARCHAR(100),
      version VARCHAR(50),
      status VARCHAR(50),
      requester VARCHAR(100),
      scheduled_at TIMESTAMP,
      risk_level VARCHAR(50)
    `,
    insertQuery: 'INSERT INTO enterprise_change_requests (id, tenant_id, system, service, version, status, requester, scheduled_at, risk_level) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING',
    getParams: (row, tenantId) => [row.id, tenantId, row.system, row.service, row.version, row.status, row.requester, row.scheduled_at, row.risk_level]
  },
  'enterprise_knowledge_base.jsonl': {
    tableName: 'enterprise_knowledge_base',
    schema: `
      id VARCHAR(50) PRIMARY KEY,
      tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
      platform VARCHAR(100),
      title TEXT,
      service VARCHAR(100),
      runbook_steps TEXT,
      last_updated_at TIMESTAMP
    `,
    insertQuery: 'INSERT INTO enterprise_knowledge_base (id, tenant_id, platform, title, service, runbook_steps, last_updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING',
    getParams: (row, tenantId) => [row.id, tenantId, row.platform, row.title, row.service, row.runbook_steps, row.last_updated_at]
  }
};

async function seed() {
  console.log("🐚 [SaaS Neon Seeder] Starting dynamic control plane & multi-tenant RLS seeder...");

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("✓ Connected to Neon Serverless Postgres.");

    // ==========================================
    // 1. SETUP CONTROL PLANE TABLES
    // ==========================================
    console.log("\nDeploying Control Plane schemas...");

    // Tenants (organizations)
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        plan VARCHAR(50) DEFAULT 'starter',
        status VARCHAR(20) DEFAULT 'active',
        neon_project_id VARCHAR(255),
        neon_conn_string TEXT,
        stripe_customer_id VARCHAR(255),
        stripe_subscription_id VARCHAR(255),
        settings JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log("  - Created tenants table.");

    // Users
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        role VARCHAR(50) DEFAULT 'member',
        auth_provider VARCHAR(50),
        auth_provider_id VARCHAR(255),
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, email)
      );
    `);
    console.log("  - Created users table.");

    // API Keys
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        created_by UUID REFERENCES users(id),
        name VARCHAR(255) NOT NULL,
        key_prefix VARCHAR(16) NOT NULL,
        key_hash VARCHAR(128) NOT NULL,
        scopes TEXT[] DEFAULT '{read,investigate}',
        last_used_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log("  - Created api_keys table.");

    // Investigation History
    await client.query(`
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
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log("  - Created investigations table.");

    // ==========================================
    // 2. SEED DEFAULT CONTROL PLANE ORGANIZATIONS
    // ==========================================
    console.log("\nSeeding default tenant metadata...");
    
    // Seed default organization
    await client.query(`
      INSERT INTO tenants (id, name, slug, plan, status)
      VALUES ($1, 'Quest Global Engineering Services', 'quest-global', 'starter', 'active')
      ON CONFLICT (id) DO NOTHING
    `, [SEED_TENANT_ID]);

    // Seed primary administrator account
    await client.query(`
      INSERT INTO users (id, tenant_id, email, name, role, auth_provider, last_login_at)
      VALUES ($1, $2, 'sre-lead@quest-global.com', 'Priya Sharma', 'owner', 'seed', NOW())
      ON CONFLICT (id) DO NOTHING
    `, [SEED_USER_ID, SEED_TENANT_ID]);

    console.log(`  - Seeded main Tenant Org [ID: ${SEED_TENANT_ID}]`);
    console.log(`  - Seeded primary Admin User [ID: ${SEED_USER_ID}, Email: sre-lead@quest-global.com]`);

    // ==========================================
    // 3. SEED TELEMETRY DATA WITH RLS SCOPING
    // ==========================================
    for (const [filename, config] of Object.entries(filesToTableMap)) {
      const filePath = path.join(dataDir, filename);
      if (!fs.existsSync(filePath)) {
        console.warn(`⚠️ Mock file not found: ${filename}, skipping table creation.`);
        continue;
      }

      console.log(`\nMigrating table [${config.tableName}]...`);
      // Drop table first to ensure a clean multi-tenant slate
      await client.query(`DROP TABLE IF EXISTS ${config.tableName} CASCADE`);
      
      // Create table with tenant_id support
      const createTableQuery = `CREATE TABLE ${config.tableName} (${config.schema})`;
      await client.query(createTableQuery);
      
      // Enable Row-Level Security (RLS) for tenant isolation
      await client.query(`ALTER TABLE ${config.tableName} ENABLE ROW LEVEL SECURITY`);
      
      // Enforce: Current session app.tenant_id must match the row's tenant_id
      await client.query(`
        CREATE POLICY tenant_scoping_policy ON ${config.tableName}
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      `);
      console.log(`  - Enabled Row-Level Security (RLS) scoping policy.`);

      // Parse JSONL and insert rows bound to our Seed Tenant
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const lines = fileContent.split('\n').filter(line => line.trim().length > 0);
      let insertCount = 0;

      for (const line of lines) {
        try {
          const rowObj = JSON.parse(line);
          const params = config.getParams(rowObj, SEED_TENANT_ID);
          await client.query(config.insertQuery, params);
          insertCount++;
        } catch (rowErr) {
          console.error(`  - Failed to insert row: ${rowErr.message}`);
        }
      }

      console.log(`  - Successfully seeded ${insertCount}/${lines.length} tenant-isolated records.`);
    }

    console.log("\n✨ [SaaS Neon Seeder] Multi-tenant RLS Database successfully migrated and seeded!");
  } catch (err) {
    console.error("❌ Database seeding failed:", err.message);
  } finally {
    await client.end();
  }
}

seed();