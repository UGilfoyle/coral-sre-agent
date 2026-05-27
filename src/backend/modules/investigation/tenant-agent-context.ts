import { getTenantContext } from '../tenant/tenant.service.js';
import { listIntegrations } from '../integration/integration.service.js';
import {
  DEFAULT_SERVICE_NAMES,
  TenantAgentContext,
  buildAvailableTables
} from './tenant-agent-config.js';

export { DEFAULT_SERVICE_NAMES, TABLE_PROVIDER_MAP, filterTablesForTenant } from './tenant-agent-config.js';
export type { TenantAgentContext } from './tenant-agent-config.js';

export async function buildTenantAgentContext(tenantId: string): Promise<TenantAgentContext> {
  const tenant = await getTenantContext(tenantId);
  const integrations = await listIntegrations(tenantId);

  const connectedProviders = new Set(
    integrations
      .filter(i => i.status === 'connected' || i.status === 'simulated')
      .map(i => i.provider)
  );

  const serviceNames =
    tenant?.settings?.serviceNames?.length
      ? tenant.settings.serviceNames
      : DEFAULT_SERVICE_NAMES;

  return {
    tenantId,
    serviceNames,
    connectedProviders,
    availableTables: buildAvailableTables(connectedProviders)
  };
}
