import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterTablesForTenant,
  DEFAULT_SERVICE_NAMES
} from './tenant-agent-config.ts';

describe('filterTablesForTenant', () => {
  const baseContext: TenantAgentContext = {
    tenantId: 'test-tenant',
    serviceNames: DEFAULT_SERVICE_NAMES,
    connectedProviders: new Set(['jira']),
    availableTables: ['deployments.history', 'enterprise.tickets']
  };

  it('only includes tables backed by connected integrations', () => {
    const all = [
      'deployments.history',
      'pagerduty.incidents',
      'sentry.errors',
      'enterprise.tickets'
    ];
    const filtered = filterTablesForTenant(all, baseContext);
    assert.deepEqual(filtered, ['deployments.history', 'enterprise.tickets']);
  });

  it('returns empty when no integrations match planned tables', () => {
    const filtered = filterTablesForTenant(['pagerduty.incidents', 'sentry.errors'], baseContext);
    assert.deepEqual(filtered, []);
  });
});
