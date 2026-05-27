import { ToolAdapter, HealthStatus } from './adapter.interface.js';
import { queryTenantPostgres, queryControlPlanePostgres } from '../../../shared/database.js';
import { decryptToken } from '../../../shared/crypto.js';

export class GitHubAdapter implements ToolAdapter {
  provider = 'github';

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
      console.log(`[GitHub Adapter] [Tenant: ${tenantId}] Simulated Mode. Querying local database...`);
      return queryTenantPostgres(tenantId, "SELECT * FROM github_builds ORDER BY trigger_time DESC LIMIT 50");
    }

    // 2. Live API Mode
    if (integration.access_token_enc) {
      const token = decryptToken(integration.access_token_enc);
      const owner = config.owner || 'quest-global';
      const repo = config.repo || 'payment-service';
      console.log(`[GitHub Adapter] [Tenant: ${tenantId}] Live API Mode. Querying repo ${owner}/${repo}...`);

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=50`, {
          headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Coral-AI-SRE-Agent'
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`GitHub API returned status ${response.status}`);
        }

        const data = await response.json();
        const runs = data.workflow_runs || [];

        return runs.map((run: any) => ({
          id: String(run.id),
          tenant_id: tenantId,
          workflow_name: run.name || 'CI/CD Pipeline',
          commit_sha: run.head_sha,
          branch: run.head_branch,
          status: run.conclusion || run.status,
          trigger_time: run.created_at,
          duration_seconds: run.run_duration_ms ? Math.floor(run.run_duration_ms / 1000) : 120,
          error_log: run.html_url,
          triggered_by: run.triggering_actor?.login || 'system'
        }));
      } catch (err: any) {
        console.error(`❌ [GitHub Adapter] Fetch failed: ${err.message}. Falling back to DB cache.`);
        return queryTenantPostgres(tenantId, "SELECT * FROM github_builds ORDER BY trigger_time DESC LIMIT 50");
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

        // Ping GitHub API user info
        const response = await fetch('https://api.github.com/user', {
          headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Coral-AI-SRE-Agent'
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.status === 401) {
          return { status: 'unhealthy', message: 'Authentication failed. Invalid Personal Access Token.' };
        } else if (!response.ok) {
          return { status: 'unhealthy', message: `Server error: HTTP ${response.status}` };
        }

        return {
          status: 'healthy',
          message: 'Connection securely verified with Live GitHub API.',
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
