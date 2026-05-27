import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toPublicIntegrationStatus } from './integration-status.ts';

describe('toPublicIntegrationStatus', () => {
  it('returns disconnected when no integration row exists', () => {
    assert.equal(toPublicIntegrationStatus(false, {}), 'disconnected');
    assert.equal(toPublicIntegrationStatus(false, null), 'disconnected');
  });

  it('returns simulated when config.simulated is true', () => {
    assert.equal(toPublicIntegrationStatus(true, { simulated: true }), 'simulated');
  });

  it('returns connected for live integrations', () => {
    assert.equal(toPublicIntegrationStatus(true, { simulated: false }), 'connected');
    assert.equal(toPublicIntegrationStatus(true, {}), 'connected');
  });
});
