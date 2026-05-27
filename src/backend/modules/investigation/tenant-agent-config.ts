export const DEFAULT_SERVICE_NAMES = [
  'api-gateway',
  'user-service',
  'payment-service',
  'order-service',
  'notification-service'
];

export const TABLE_PROVIDER_MAP: Record<string, string | null> = {
  'deployments.history': null,
  'pagerduty.incidents': 'pagerduty',
  'sentry.errors': 'sentry',
  'github.builds': 'github',
  'slack.threads': 'slack',
  'enterprise.tickets': 'jira',
  'enterprise.change_requests': null,
  'enterprise.knowledge_base': null
};

export interface TenantAgentContext {
  tenantId: string;
  serviceNames: string[];
  connectedProviders: Set<string>;
  availableTables: string[];
}

export function filterTablesForTenant(allTables: string[], context: TenantAgentContext): string[] {
  return allTables.filter(table => context.availableTables.includes(table));
}

export function buildAvailableTables(connectedProviders: Set<string>): string[] {
  return Object.entries(TABLE_PROVIDER_MAP)
    .filter(([, provider]) => provider === null || connectedProviders.has(provider))
    .map(([table]) => table);
}
