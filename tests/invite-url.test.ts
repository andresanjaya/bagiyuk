import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inviteOrigin } from '../src/lib/invite-url';

test('invites use the configured public address, then the browser origin', () => {
  const request = new Request('http://0.0.0.0:3000/api/split/id/invites', { headers: { origin: 'https://bagiyuk.vercel.app' } });
  assert.equal(inviteOrigin(request), 'https://bagiyuk.vercel.app');
  assert.equal(inviteOrigin(request, 'https://bagiyuk.example.com/'), 'https://bagiyuk.example.com');
});

test('invites never publish an unspecified server bind address', () => {
  const request = new Request('http://0.0.0.0:3000/api/split/id/invites');
  assert.throws(() => inviteOrigin(request), /APP_URL_UNREACHABLE/);
  assert.throws(() => inviteOrigin(request, 'http://0.0.0.0:3000'), /APP_URL_UNREACHABLE/);
  assert.throws(() => inviteOrigin(request, 'javascript:alert(1)'), /APP_URL_UNREACHABLE/);
});
