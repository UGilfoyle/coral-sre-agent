import { ToolAdapter, HealthStatus } from './adapter.interface.js';
import { queryTenantPostgres, queryControlPlanePostgres } from '../../../shared/database.js';
import { decryptToken } from '../../../shared/crypto.js';

export class JiraAdapter implements ToolAdapter {
  provider = 'jira';

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
      console.log(`[Jira Adapter] [Tenant: ${tenantId}] Simulated Mode. Querying local database...`);
      return queryTenantPostgres(tenantId, "SELECT * FROM enterprise_tickets ORDER BY created_at DESC LIMIT 50");
    }

    // 2. Live API Mode
    if (integration.access_token_enc) {
      const token = decryptToken(integration.access_token_enc);
      const host = config.host || 'your-domain.atlassian.net';
      const projectKey = config.projectKey || 'SRE';
      console.log(`[Jira Adapter] [Tenant: ${tenantId}] Live API Mode. Querying Jira project key ${projectKey} on host ${host}...`);

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        // Basic Auth with email:token or Bearer Token depending on OAuth
        const authHeader = token.includes(':') 
          ? `Basic ${Buffer.from(token).toString('base64')}` 
          : `Bearer ${token}`;

        const response = await fetch(`https://${host}/rest/api/3/search?jql=project=${projectKey}&maxResults=50`, {
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Jira API returned status ${response.status}`);
        }

        const data = await response.json();
        const issues = data.issues || [];

        return issues.map((issue: any) => ({
          id: issue.id || issue.key,
          tenant_id: tenantId,
          board: projectKey,
          title: issue.fields?.summary || '',
          status: issue.fields?.status?.name || 'Todo',
          priority: issue.fields?.priority?.name || 'Medium',
          assignee: issue.fields?.assignee?.displayName || 'unassigned',
          service: issue.fields?.customfield_10000 || 'payment-service', // custom field or fallback
          created_at: issue.fields?.created || new Date().toISOString()
        }));
      } catch (err: any) {
        console.error(`❌ [Jira Adapter] Fetch failed: ${err.message}. Falling back to DB cache.`);
        return queryTenantPostgres(tenantId, "SELECT * FROM enterprise_tickets ORDER BY created_at DESC LIMIT 50");
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
        const host = config.host || 'your-domain.atlassian.net';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const authHeader = token.includes(':') 
          ? `Basic ${Buffer.from(token).toString('base64')}` 
          : `Bearer ${token}`;

        // Ping Jira's myself endpoint
        const response = await fetch(`https://${host}/rest/api/3/myself`, {
          headers: {
            'Authorization': authHeader,
            'Accept': 'application/json'
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.status === 401 || response.status === 403) {
          return { status: 'unhealthy', message: 'Authentication failed. Invalid email, domain, or token.' };
        } else if (!response.ok) {
          return { status: 'unhealthy', message: `Server error: HTTP ${response.status}` };
        }

        return {
          status: 'healthy',
          message: 'Connection securely verified with Live Jira API.',
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
