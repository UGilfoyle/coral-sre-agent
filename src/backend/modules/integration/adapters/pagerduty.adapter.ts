import { ToolAdapter, HealthStatus } from './adapter.interface.js';
import { queryTenantPostgres, queryControlPlanePostgres } from '../../../shared/database.js';
import { decryptToken } from '../../../shared/crypto.js';
import { mapPagerDutyIncidents } from './pagerduty.mapper.js';

export class PagerDutyAdapter implements ToolAdapter {
  provider = 'pagerduty';

  async fetchData(tenantId: string, table: string, criteria?: any): Promise<any[]> {
    // Check connection context in control plane database
    const integrations = await queryControlPlanePostgres(
      "SELECT * FROM integrations WHERE tenant_id = $1 AND provider = $2",
      [tenantId, this.provider]
    );

    if (integrations.length === 0) {
      return []; // Return empty if integration is disconnected
    }

    const integration = integrations[0];
    const config = typeof integration.config === 'string' ? JSON.parse(integration.config) : (integration.config || {});

    // 1. Simulated/Mock Mode: query the tenant-isolated PG tables
    if (config.simulated) {
      console.log(`[PagerDuty Adapter] [Tenant: ${tenantId}] Simulated Mode. Querying local database...`);
      return queryTenantPostgres(tenantId, "SELECT * FROM pagerduty_incidents ORDER BY created_at DESC LIMIT 50");
    }

    // 2. Live API Mode
    if (integration.access_token_enc) {
      const token = decryptToken(integration.access_token_enc);
      console.log(`[PagerDuty Adapter] [Tenant: ${tenantId}] Live API Mode. Querying PagerDuty APIs...`);
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

        const response = await fetch('https://api.pagerduty.com/incidents?limit=50', {
          headers: {
            'Authorization': `Token token=${token}`,
            'Accept': 'application/vnd.pagerduty+json;version=2',
            'Content-Type': 'application/json'
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`PagerDuty API returned status ${response.status}`);
        }

        const data = await response.json();
        const incidents = data.incidents || [];

        return mapPagerDutyIncidents(incidents, tenantId);
      } catch (err: any) {
        console.error(`❌ [PagerDuty Adapter] Fetch failed: ${err.message}. Falling back to DB cache.`);
        // Gracefully fall back to local database so developer experience is never broken
        return queryTenantPostgres(tenantId, "SELECT * FROM pagerduty_incidents ORDER BY created_at DESC LIMIT 50");
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
        // Simulated health check
        await queryTenantPostgres(tenantId, "SELECT 1");
        return {
          status: 'healthy',
          message: 'Simulation connection fully active and verified.',
          latencyMs: Date.now() - start
        };
      }

      if (integration.access_token_enc) {
        const token = decryptToken(integration.access_token_enc);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        // Ping PagerDuty api health check endpoint
        const response = await fetch('https://api.pagerduty.com/users/me', {
          headers: {
            'Authorization': `Token token=${token}`,
            'Accept': 'application/vnd.pagerduty+json;version=2'
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.status === 401) {
          return { status: 'unhealthy', message: 'Authentication failed. Invalid API token.' };
        } else if (!response.ok) {
          return { status: 'unhealthy', message: `Server error: HTTP ${response.status}` };
        }

        return {
          status: 'healthy',
          message: 'Connection securely verified with Live PagerDuty API.',
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
