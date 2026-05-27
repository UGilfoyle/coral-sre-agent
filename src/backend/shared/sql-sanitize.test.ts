import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeSqlStringLiteral,
  sanitizeServiceNames,
  sanitizeTimestamp,
  toSqlLiteral
} from './sql-sanitize.ts';

describe('sql-sanitize', () => {
  it('escapes single quotes in SQL literals', () => {
    assert.equal(escapeSqlStringLiteral("payment' OR '1'='1"), "payment'' OR ''1''=''1");
    assert.equal(toSqlLiteral("payment' OR '1'='1"), "'payment'' OR ''1''=''1'");
  });

  it('rejects malicious service names', () => {
    const input = ["payment-service", "payment' OR '1'='1", 'evil; DROP TABLE--'];
    assert.deepEqual(sanitizeServiceNames(input), ['payment-service']);
  });

  it('accepts valid service identifiers', () => {
    assert.deepEqual(sanitizeServiceNames(['api-gateway', 'user-service.v2']), [
      'api-gateway',
      'user-service.v2'
    ]);
  });

  it('validates ISO timestamps', () => {
    assert.equal(sanitizeTimestamp('2026-05-26T16:00:00Z'), '2026-05-26T16:00:00Z');
    assert.equal(sanitizeTimestamp("2026-05-26T16:00:00Z'; DROP TABLE--"), null);
  });
});
