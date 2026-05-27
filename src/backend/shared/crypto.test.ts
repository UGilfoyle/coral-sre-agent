import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encryptToken, decryptToken } from './crypto.ts';

describe('crypto vault', () => {
  it('round-trips a token through encrypt and decrypt', () => {
    const original = 'pagerduty-secret-token-abc123';
    const encrypted = encryptToken(original);

    assert.notEqual(encrypted, original);
    assert.match(encrypted, /^[0-9a-f]+\.[0-9a-f]+\.[0-9a-f]+$/);

    const decrypted = decryptToken(encrypted);
    assert.equal(decrypted, original);
  });

  it('produces unique ciphertext for the same plaintext', () => {
    const original = 'same-token-value';
    const first = encryptToken(original);
    const second = encryptToken(original);

    assert.notEqual(first, second);
    assert.equal(decryptToken(first), original);
    assert.equal(decryptToken(second), original);
  });

  it('returns empty string for empty input', () => {
    assert.equal(encryptToken(''), '');
    assert.equal(decryptToken(''), '');
  });

  it('throws when ciphertext format is invalid', () => {
    assert.throws(
      () => decryptToken('not-valid-ciphertext'),
      /Failed to decrypt credentials/
    );
  });

  it('throws when auth tag is tampered', () => {
    const encrypted = encryptToken('sensitive-token');
    const [iv, payload, authTag] = encrypted.split('.');
    const tamperedTag = authTag.slice(0, -1) + (authTag.endsWith('a') ? 'b' : 'a');

    assert.throws(
      () => decryptToken(`${iv}.${payload}.${tamperedTag}`),
      /Failed to decrypt credentials/
    );
  });
});
