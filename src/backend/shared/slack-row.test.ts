import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { slackUsernameFromRow } from './slack-row.ts';

describe('slackUsernameFromRow', () => {
  it('reads author from JSONL user field', () => {
    assert.equal(slackUsernameFromRow({ user: 'priya.sharma' }), 'priya.sharma');
  });

  it('reads author from Postgres username field', () => {
    assert.equal(slackUsernameFromRow({ username: 'rajesh.kumar' }), 'rajesh.kumar');
  });

  it('prefers user when both are present', () => {
    assert.equal(
      slackUsernameFromRow({ user: 'jsonl-user', username: 'db-user' }),
      'jsonl-user'
    );
  });

  it('returns null when neither field is set', () => {
    assert.equal(slackUsernameFromRow({}), null);
  });
});
