import { queryControlPlanePostgres } from '../../shared/database.js';
import { encryptToken } from '../../shared/crypto.js';
import { ToolAdapter, HealthStatus } from './adapters/adapter.interface.js';
import { PagerDutyAdapter } from './adapters/pagerduty.adapter.js';
import { SentryAdapter } from './adapters/sentry.adapter.js';
import { GitHubAdapter } from './adapters/github.adapter.js';
import { SlackAdapter } from './adapters/slack.adapter.js';
import { JiraAdapter } from './adapters/jira.adapter.js';
import { toPublicIntegrationStatus } from './integration-status.js';
import { provisionSandboxDataForTenant, countSandboxRowsForProvider } from './sandbox-data.service.js';

// Instantiate and register adapters
const ADAPTERS: Record<string, ToolAdapter> = {
  pagerduty: new PagerDutyAdapter(),
  sentry: new SentryAdapter(),
  github: new GitHubAdapter(),
  slack: new SlackAdapter(),
  jira: new JiraAdapter()
};

/**
 * Initializes the integrations control plane schema inside the database.
 * Ensures smooth zero-config deployments.
 */
export async function initIntegrationsSchema() {
  try {
    await queryControlPlanePostgres(`
      CREATE TABLE IF NOT EXISTS integrations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        provider VARCHAR(50) NOT NULL,
        display_name VARCHAR(255),
        status VARCHAR(20) DEFAULT 'pending',
        scopes TEXT[],
        access_token_enc TEXT,
        refresh_token_enc TEXT,
        token_expires_at TIMESTAMPTZ,
        config JSONB DEFAULT '{}',
        last_sync_at TIMESTAMPTZ,
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, provider)
      );
    `);
    console.log("  ✓ verified integrations control plane table structure.");
  } catch (err: any) {
    console.error("⚠️ Failed to verify integrations schema in Neon Postgres:", err.message);
  }
}

/**
 * Lists all integrations for a tenant. If no integration is found, 
 * returns a disconnected placeholder, assuring consistent UI grids.
 */
export async function listIntegrations(tenantId: string) {
  const rows = await queryControlPlanePostgres(
    "SELECT id, provider, status, config, last_sync_at, error_message FROM integrations WHERE tenant_id = $1",
    [tenantId]
  );

  const existingMap = new Map(rows.map(r => [r.provider, r]));
  const providers = ['pagerduty', 'sentry', 'github', 'slack', 'jira'];

  return providers.map(p => {
    const existing = existingMap.get(p);
    if (existing) {
      const config = typeof existing.config === 'string' ? JSON.parse(existing.config) : (existing.config || {});
      return {
        provider: p,
        status: toPublicIntegrationStatus(true, config),
        config,
        lastSyncAt: existing.last_sync_at,
        errorMessage: existing.error_message
      };
    }
    return {
      provider: p,
      status: 'disconnected',
      config: {},
      lastSyncAt: null,
      errorMessage: null
    };
  });
}

/**
 * Connects or updates a tenant's integration.
 */
export async function connectIntegration(
  tenantId: string,
  provider: string,
  mode: 'live' | 'simulated',
  credentials?: { apiKey?: string; token?: string },
  configObj?: any
) {
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    throw new Error(`Unsupported integration provider: ${provider}`);
  }

  const finalConfig = {
    ...configObj,
    simulated: mode === 'simulated'
  };

  const status = 'active';
  let accessTokenEnc: string | null = null;

  if (mode === 'live' && credentials) {
    const rawToken = credentials.apiKey || credentials.token;
    if (!rawToken) {
      throw new Error(`Token or API Key is required for live ${provider} connection.`);
    }
    accessTokenEnc = encryptToken(rawToken);
  }

  // Insert or update on conflict (tenant_id, provider)
  await queryControlPlanePostgres(`
    INSERT INTO integrations (tenant_id, provider, display_name, status, access_token_enc, config, last_sync_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (tenant_id, provider)
    DO UPDATE SET 
      status = EXCLUDED.status,
      access_token_enc = CASE
        WHEN (EXCLUDED.config->>'simulated')::boolean = true THEN NULL
        WHEN EXCLUDED.access_token_enc IS NOT NULL THEN EXCLUDED.access_token_enc
        ELSE integrations.access_token_enc
      END,
      config = EXCLUDED.config,
      error_message = NULL,
      updated_at = NOW(),
      last_sync_at = NOW()
  `, [
    tenantId, 
    provider, 
    `${provider.substring(0, 1).toUpperCase()}${provider.substring(1)} Connection`,
    status,
    accessTokenEnc,
    JSON.stringify(finalConfig)
  ]);

  if (mode === 'simulated') {
    await queryControlPlanePostgres(
      'UPDATE integrations SET access_token_enc = NULL WHERE tenant_id = $1 AND provider = $2',
      [tenantId, provider]
    );
    await provisionSandboxDataForTenant(tenantId);
  }

  return { success: true, provider, status: toPublicIntegrationStatus(true, finalConfig) };
}

/**
 * Disconnects an integration.
 */
export async function disconnectIntegration(tenantId: string, provider: string) {
  const result = await queryControlPlanePostgres(
    "DELETE FROM integrations WHERE tenant_id = $1 AND provider = $2 RETURNING id",
    [tenantId, provider]
  );
  
  return { success: result.length > 0 };
}

/**
 * Runs a real-time integration connection diagnostic and latency ping check.
 */
export async function checkIntegrationHealth(tenantId: string, provider: string): Promise<HealthStatus> {
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    return { status: 'unhealthy', message: `Unknown integration provider: ${provider}` };
  }

  try {
    const health = await adapter.healthCheck(tenantId);

    const integrationRows = await queryControlPlanePostgres(
      'SELECT config FROM integrations WHERE tenant_id = $1 AND provider = $2',
      [tenantId, provider]
    );
    const config = integrationRows[0]
      ? (typeof integrationRows[0].config === 'string'
        ? JSON.parse(integrationRows[0].config)
        : (integrationRows[0].config || {}))
      : {};

    if (config.simulated && health.status === 'healthy') {
      const demoCount = await countSandboxRowsForProvider(tenantId, provider);
      if (demoCount === 0) {
        return {
          status: 'unhealthy',
          message: 'Sandbox connected but no demo records found. Run "pnpm seed" once, then reconnect Sandbox Demo.'
        };
      }
      health.message = `Sandbox active with ${demoCount} demo records ready to query.`;
    }
    
    // Update DB with the latest health check details
    const status = health.status === 'healthy' ? 'active' : 'error';
    await queryControlPlanePostgres(
      "UPDATE integrations SET status = $1, error_message = $2, last_sync_at = NOW() WHERE tenant_id = $3 AND provider = $4",
      [status, health.status === 'unhealthy' ? health.message : null, tenantId, provider]
    );

    return health;
  } catch (err: any) {
    return {
      status: 'unhealthy',
      message: `Diagnostic execution failed: ${err.message}`
    };
  }
}

/**
 * Helper to fetch data from an integration provider.
 */
export async function fetchIntegrationData(tenantId: string, provider: string, table: string, criteria?: any): Promise<any[]> {
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    throw new Error(`No adapter registered for provider: ${provider}`);
  }
  return adapter.fetchData(tenantId, table, criteria);
}

/**
 * Synchronizes live data from an integration provider into the cache table.
 * Only triggers if the integration is connected and in Live mode.
 */
export async function syncIntegrationDataIfLive(tenantId: string, provider: string, tableName: string) {
  try {
    const integrations = await queryControlPlanePostgres(
      "SELECT * FROM integrations WHERE tenant_id = $1 AND provider = $2 AND status = 'active'",
      [tenantId, provider]
    );

    if (integrations.length === 0) return; // Disconnected or doesn't exist

    const integration = integrations[0];
    const config = typeof integration.config === 'string' ? JSON.parse(integration.config) : (integration.config || {});
    
    if (config.simulated) {
      return; // Simulated mode, do not sync from live API
    }

    if (integration.access_token_enc) {
      console.log(`📡 [Integration Sync] Syncing live ${provider} data for tenant ${tenantId}...`);
      const rows = await fetchIntegrationData(tenantId, provider, tableName);
      if (rows.length === 0) return;

      // Delete existing cached records for this tenant in the database table
      await queryControlPlanePostgres(
        `DELETE FROM ${tableName} WHERE tenant_id = $1`,
        [tenantId]
      );

      // Insert new rows
      for (const row of rows) {
        const columns = Object.keys(row).filter(c => c !== 'id');
        const placeholders = columns.map((_, i) => `$${i + 2}`).join(', ');
        const colList = columns.join(', ');
        
        const values = columns.map(c => row[c]);
        await queryControlPlanePostgres(
          `INSERT INTO ${tableName} (id, ${colList}) VALUES ($1, ${placeholders}) ON CONFLICT (id) DO NOTHING`,
          [row.id, ...values]
        );
      }
      console.log(`  ✓ [Integration Sync] Synchronized ${rows.length} live records into ${tableName}`);
    }
  } catch (err: any) {
    console.error(`❌ [Integration Sync] Failed to sync ${provider}: ${err.message}`);
  }
}
