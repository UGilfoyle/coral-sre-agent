import {
  connectIntegration,
  listIntegrations,
  checkIntegrationHealth
} from '../integration/integration.service.js';
import { countSandboxRowsForProvider } from '../integration/sandbox-data.service.js';
import { isNeonConnected } from '../../shared/database.js';

export const DEMO_PROVIDERS = ['pagerduty', 'sentry', 'github', 'slack', 'jira'] as const;

export const FLAGSHIP_INVESTIGATION_PROMPT =
  'Investigate the current production outage. Correlate PagerDuty incidents with recent deployments and Sentry errors.';

export async function getDemoStatus(tenantId: string) {
  const integrations = await listIntegrations(tenantId);
  const byProvider = new Map(integrations.map((i) => [i.provider, i]));

  const providerStatus = DEMO_PROVIDERS.map((provider) => {
    const row = byProvider.get(provider);
    const connected = row?.status === 'simulated' || row?.status === 'connected';
    return {
      provider,
      status: row?.status ?? 'disconnected',
      connected
    };
  });

  const connectedCount = providerStatus.filter((p) => p.connected).length;

  let sandboxRowCount = 0;
  if (isNeonConnected()) {
    for (const provider of DEMO_PROVIDERS) {
      sandboxRowCount += await countSandboxRowsForProvider(tenantId, provider);
    }
  }

  return {
    ready: connectedCount === DEMO_PROVIDERS.length,
    connectedCount,
    totalProviders: DEMO_PROVIDERS.length,
    neonConnected: isNeonConnected(),
    sandboxRowCount,
    providers: providerStatus,
    flagshipPrompt: FLAGSHIP_INVESTIGATION_PROMPT
  };
}

export async function bootstrapDemoEnvironment(tenantId: string) {
  const results: {
    provider: string;
    status: 'connected' | 'error';
    message?: string;
  }[] = [];

  for (const provider of DEMO_PROVIDERS) {
    try {
      await connectIntegration(tenantId, provider, 'simulated', undefined, {});
      const health = await checkIntegrationHealth(tenantId, provider);
      results.push({
        provider,
        status: health.status === 'healthy' ? 'connected' : 'error',
        message: health.message
      });
    } catch (err: unknown) {
      results.push({
        provider,
        status: 'error',
        message: err instanceof Error ? err.message : 'Connection failed'
      });
    }
  }

  const status = await getDemoStatus(tenantId);

  return {
    results,
    ...status
  };
}
