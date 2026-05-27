import { ToolAdapter, HealthStatus } from './adapter.interface.js';
import { queryTenantPostgres, queryControlPlanePostgres } from '../../../shared/database.js';
import { decryptToken } from '../../../shared/crypto.js';

export class SlackAdapter implements ToolAdapter {
  provider = 'slack';

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
      console.log(`[Slack Adapter] [Tenant: ${tenantId}] Simulated Mode. Querying local database...`);
      return queryTenantPostgres(tenantId, "SELECT * FROM slack_threads ORDER BY ts DESC LIMIT 50");
    }

    // 2. Live API Mode
    if (integration.access_token_enc) {
      const token = decryptToken(integration.access_token_enc);
      const channelId = config.channelId || 'C0123456789';
      console.log(`[Slack Adapter] [Tenant: ${tenantId}] Live API Mode. Querying channel ${channelId}...`);

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`https://slack.com/api/conversations.history?channel=${channelId}&limit=50`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.error || `Slack API returned status ${response.status}`);
        }

        const messages = data.messages || [];

        return messages.map((msg: any) => ({
          id: msg.client_msg_id || msg.ts,
          tenant_id: tenantId,
          channel: config.channelName || 'incidents',
          ts: new Date(parseFloat(msg.ts) * 1000).toISOString(),
          username: msg.user_profile?.name || msg.username || msg.user || 'engineer',
          text: msg.text || '',
          replies_count: msg.reply_count || 0,
          replies: JSON.stringify(msg.reply_users || [])
        }));
      } catch (err: any) {
        console.error(`❌ [Slack Adapter] Fetch failed: ${err.message}. Falling back to DB cache.`);
        return queryTenantPostgres(tenantId, "SELECT * FROM slack_threads ORDER BY ts DESC LIMIT 50");
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
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        // Ping Slack auth.test api endpoint
        const response = await fetch('https://slack.com/api/auth.test', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        const data = await response.json();
        if (response.status === 401 || !data.ok) {
          return { status: 'unhealthy', message: `Authentication failed: ${data.error || 'Invalid token'}` };
        }

        return {
          status: 'healthy',
          message: `Connection securely verified with Slack Workspace: ${data.team}.`,
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
