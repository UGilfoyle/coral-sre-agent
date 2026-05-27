import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildErrorBlocks,
  buildInvestigationBlocks,
  parseSlackPrompt
} from './slack-blocks.ts';

describe('parseSlackPrompt', () => {
  it('strips investigate prefix', () => {
    assert.equal(parseSlackPrompt('investigate payment-service errors'), 'payment-service errors');
  });

  it('returns raw prompt when no prefix', () => {
    assert.equal(parseSlackPrompt('payment-service rollback status'), 'payment-service rollback status');
  });

  it('returns empty for blank input', () => {
    assert.equal(parseSlackPrompt('   '), '');
  });
});

describe('buildInvestigationBlocks', () => {
  const sampleResponse = {
    answer: '**Incident Overview**\nPayment service degraded.',
    sqlQueries: ['SELECT 1', 'SELECT 2'],
    sqlResults: [],
    timeline: [
      { time: '16:43:00', title: 'Deploy v2.4.1', desc: 'Gateway refactor', type: 'deploy' as const }
    ],
    rootCause: {
      service: 'payment-service',
      reason: 'Breaking adapter interface in v2.4.1',
      commit: '7c3a9f1e',
      author: 'dev',
      resolution: 'Rollback to v2.4.0'
    },
    coralFeatures: ['sql-interface'],
    queryTimeMs: 842
  };

  it('builds Block Kit sections from agent response', () => {
    const blocks = buildInvestigationBlocks('payment errors', sampleResponse, 'inv-123');
    assert.ok(blocks.length >= 4);
    assert.equal((blocks[0] as any).type, 'header');
    const joined = JSON.stringify(blocks);
    assert.match(joined, /payment-service/);
    assert.match(joined, /Rollback to v2.4.0/);
  });

  it('builds error blocks', () => {
    const blocks = buildErrorBlocks('Workspace not linked');
    assert.equal((blocks[0] as any).text.text, '⚠️ Coral SRE');
  });
});
