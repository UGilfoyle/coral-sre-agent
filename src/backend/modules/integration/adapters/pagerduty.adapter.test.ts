import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapPagerDutyIncidents } from './pagerduty.mapper.ts';

describe('PagerDutyAdapter', () => {
  it('mapPagerDutyIncidents normalizes live API payloads to Coral schema', () => {
    const tenantId = 'tenant-test-uuid';
    const rows = mapPagerDutyIncidents([
      {
        id: 'P123',
        summary: 'Checkout API latency spike',
        status: 'triggered',
        urgency: 'high',
        created_at: '2026-05-27T10:00:00Z',
        service: { summary: 'checkout-api' },
        assignments: [{ assignee: { summary: 'sre-oncall' } }]
      }
    ], tenantId);

    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
      id: 'P123',
      tenant_id: tenantId,
      title: 'Checkout API latency spike',
      status: 'triggered',
      urgency: 'high',
      created_at: '2026-05-27T10:00:00Z',
      service_name: 'checkout-api',
      assignee: 'sre-oncall'
    });
  });

  it('mapPagerDutyIncidents applies safe defaults for missing fields', () => {
    const rows = mapPagerDutyIncidents([
      {
        id: 'P999',
        title: 'Minimal incident',
        status: 'resolved',
        urgency: 'low',
        created_at: '2026-05-27T11:00:00Z'
      }
    ], 'tenant-abc');

    assert.equal(rows[0].service_name, 'unknown-service');
    assert.equal(rows[0].assignee, 'unassigned');
  });
});
