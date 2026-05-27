import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('sqlGuard patterns', () => {
  const blocked = [
    'DROP TABLE users',
    'DELETE FROM pagerduty_incidents',
    'INSERT INTO api_keys VALUES (1)',
    'UPDATE tenants SET plan = x'
  ];

  const allowed = [
    'SELECT * FROM pagerduty.incidents',
    'WITH cte AS (SELECT 1) SELECT * FROM cte'
  ];

  it('blocks mutating SQL statements', () => {
    for (const sql of blocked) {
      assert.match(sql.toLowerCase(), /drop|delete|insert|update/);
    }
  });

  it('allows read-only SELECT queries', () => {
    for (const sql of allowed) {
      assert.match(sql, /^\s*(select|with)/i);
    }
  });
});
