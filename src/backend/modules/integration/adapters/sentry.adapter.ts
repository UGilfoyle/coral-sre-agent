import { ToolAdapter, HealthStatus } from './adapter.interface.js';
import { queryTenantPostgres, queryControlPlanePostgres } from '../../../shared/database.js';
import { decryptToken } from '../../../shared/crypto.js';

export class SentryAdapter implements ToolAdapter {
  provider = 'sentry';

  async fetchData(tenantId: string, table: string, criteria?: any): Promise<any[]> {
    const integrations = await queryControlPlanePostgres(
      "SELECT * FROM integrations WHERE tenant_id = $1 AND provider = $2",
      [tenantId, this.provider]
    );

    if (integrations.length === 0) {
      return [];
    }

    const integration = integrations[0];
    const config = typeof integration.config === 'string' ? JSON.parse(integration.config) : (integration.config || {});

    // 1. Simulated Mode
    if (config.simulated) {
      console.log(`[Sentry Adapter] [Tenant: ${tenantId}] Simulated Mode. Querying local database...`);
      return queryTenantPostgres(tenantId, "SELECT * FROM sentry_errors ORDER BY last_seen DESC LIMIT 50");
    }

    // 2. Live API Mode
    if (integration.access_token_enc) {
      const token = decryptToken(integration.access_token_enc);
      const organizationSlug = config.organizationSlug || 'quest-global';
      const projectSlug = config.projectSlug || 'payment-service';
      console.log(`[Sentry Adapter] [Tenant: ${tenantId}] Live API Mode. Fetching from Sentry Organization: ${organizationSlug}, Project: ${projectSlug}...`);

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`https://sentry.io/api/0/projects/${organizationSlug}/${projectSlug}/issues/`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Sentry API returned status ${response.status}`);
        }

        const data = await response.json();
        const issues = Array.isArray(data) ? data : [];

        // Map live Sentry API payload to standard schema columns
        return issues.map((issue: any) => ({
          id: issue.id,
          tenant_id: tenantId,
          issue_id: issue.shortId || issue.id,
          message: issue.title || issue.message,
          status: issue.status || 'unresolved',
          level: issue.level || 'error',
          first_seen: issue.firstSeen,
          last_seen: issue.lastSeen,
          count: parseInt(issue.count || '1', 10),
          metadata__culprit: issue.culprit || 'unknown',
          stack_trace: issue.metadata?.value || JSON.stringify(issue.metadata || {})
        }));
      } catch (err: any) {
        console.error(`❌ [Sentry Adapter] Fetch failed: ${err.message}. Falling back to DB cache.`);
        return queryTenantPostgres(tenantId, "SELECT * FROM sentry_errors ORDER BY last_seen DESC LIMIT 50");
      }
    }

    return [];
  }

  async healthCheck(tenantId: string): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const integrations = await queryControlPlanePostgres(
        "SELECT * FROM integrations WHERE tenant_id = $1 AND provider = $2",
        [tenantId, this.provider]
      );

      if (integrations.length === 0) {
        return { status: 'unhealthy', message: 'Integration not configured.' };
      }

      const integration = integrations[0];
      const config = typeof integration.config === 'string' ? JSON.parse(integration.config) : (integration.config || {});

      if (config.simulated) {
        await queryTenantPostgres(tenantId, "SELECT 1");
        return {
          status: 'healthy',
          message: 'Simulation connection fully active and verified.',
          latencyMs: Date.now() - start
        };
      }

      if (integration.access_token_enc) {
        const token = decryptToken(integration.access_token_enc);
        const organizationSlug = config.organizationSlug || 'quest-global';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        // Ping Sentry API endpoint listing projects inside organization
        const response = await fetch(`https://sentry.io/api/0/organizations/${organizationSlug}/projects/`, {
          headers: {
            'Authorization': `Bearer ${token}`
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.status === 401 || response.status === 403) {
          return { status: 'unhealthy', message: 'Authentication failed. Invalid auth token.' };
        } else if (!response.ok) {
          return { status: 'unhealthy', message: `Server error: HTTP ${response.status}` };
        }

        return {
          status: 'healthy',
          message: 'Connection securely verified with Live Sentry API.',
          latencyMs: Date.now() - start
        };
      }

      return { status: 'unhealthy', message: 'No valid authentication method found.' };
    } catch (err: any) {
      return {
        status: 'unhealthy',
        message: `Network failure: ${err.message}`
      };
    }
  }
}
