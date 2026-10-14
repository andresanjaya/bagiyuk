// Run against a dedicated Supabase test project with the Phase A migration applied.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { GET, POST } from '../src/app/api/split/[...path]/route';
import { freshBill } from '../src/lib/bill';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !key || !secret) throw new Error('Configure a dedicated Supabase test project before running test:cloud.');
const admin = createClient(url, secret, { auth: { persistSession: false } });
async function actor() {
  const client = createClient<any>(url!, key!, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInAnonymously();
  assert.ifError(error); assert.ok(data.session);
  return { client, token: data.session.access_token };
}
async function post(token: string, path: string[], body: unknown) {
  const request = new Request(`http://localhost/api/split/${path.join('/')}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const response = await POST(request, { params: Promise.resolve({ path }) });
  return { status: response.status, data: await response.json() };
}
test('cloud authorization, idempotency, invite, join, and claim contention', async () => {
  const host = await actor(), guest = await actor(), guest2 = await actor(), stranger = await actor();
  const bill = freshBill(); bill.name = 'Cloud test'; bill.items = [{ id: crypto.randomUUID(), name: 'Tea', quantity: 1, price: 10000, discount: 0, assigned: [] }];
  const created = await post(host.token, ['sessions'], { bill, hostName: 'Host' });
  assert.equal(created.status, 200);
  const id = created.data.sessionId;
  assert.equal((await post(host.token, ['sessions'], { bill, hostName: 'Host' })).data.sessionId, id);
  for (const [table, patch] of Object.entries({ split_sessions: { title: 'Hacked' }, split_session_items: { name: 'Hacked' }, split_participants: { display_name: 'Hacked' }, split_item_claims: { claimed_units: 0 } })) {
    const read = await stranger.client.from(table).select('*').eq(table === 'split_sessions' ? 'id' : 'session_id', id);
    assert.deepEqual(read.data, [], `${table} leaked to a nonmember`);
    assert.ok((await guest.client.from(table).update(patch).eq(table === 'split_sessions' ? 'id' : 'session_id', id)).error, `${table} allowed direct writes`);
  }
  assert.ok((await stranger.client.from('split_invites').select('*')).error);
  assert.ok((await guest.client.from('split_session_items').insert({ session_id: id, name: 'Forged', quantity: 1, total_amount: 1, source_item_id: 'x', sort_order: 9 })).error);
  assert.equal((await post(guest.token, [id, 'open'], {})).status, 403);
  assert.equal((await post(guest.token, [id, 'invites'], {})).status, 403);
  assert.equal((await post('not-a-jwt', [id, 'open'], {})).status, 401);
  const invitation = await post(host.token, [id, 'invites'], {});
  assert.equal(invitation.status, 200);
  const raw = invitation.data.url.split('/').pop();
  assert.match(invitation.data.url, new RegExp(`/join/${raw}$`));
  const preview = await GET(new Request(`http://localhost/api/split/preview/${raw}`), { params: Promise.resolve({ path: ['preview', raw] }) });
  assert.equal(preview.status, 200);
  assert.equal((await post(guest.token, ['join'], { token: raw, name: 'Same name' })).status, 200);
  assert.equal((await post(guest.token, ['join'], { token: raw, name: 'Same name' })).status, 200);
  assert.equal((await post(guest2.token, ['join'], { token: raw, name: 'Same name' })).status, 200);
  assert.equal((await post(host.token, [id, 'open'], {})).status, 200);
  const items = await host.client.from('split_session_items').select('*').eq('session_id', id);
  assert.ifError(items.error);
  const itemId = items.data![0].id;
  assert.equal((await post(stranger.token, [id, 'claims'], { itemId, units: 1 })).status, 403);
  assert.equal((await post(guest.token, [id, 'mode'], { itemId, mode: 'shared' })).status, 403);
  assert.equal((await post(guest.token, [id, 'host-claim'], { itemId, participantId: crypto.randomUUID(), units: 1 })).status, 403);
  assert.equal((await post(guest.token, [id, 'claims'], { itemId, units: 1, participantId: 'forged' })).status, 400);
  const [a, b] = await Promise.all([post(guest.token, [id, 'claims'], { itemId, units: 1 }), post(guest2.token, [id, 'claims'], { itemId, units: 1 })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const claims = await host.client.from('split_item_claims').select('*').eq('session_id', id);
  assert.equal(claims.data?.reduce((n: number, c: { claimed_units: number }) => n + c.claimed_units, 0), 1);
  const second = await post(host.token, [id, 'invites'], {});
  const secondRaw = second.data.url.split('/').pop();
  const tokenHash = createHash('sha256').update(secondRaw).digest('hex');
  assert.ifError((await admin.from('split_invites').update({ revoked_at: new Date().toISOString() }).eq('token_hash', tokenHash)).error);
  assert.equal((await post(stranger.token, ['join'], { token: secondRaw, name: 'Late' })).status, 410);
  assert.ifError((await admin.from('split_sessions').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', id)).error);
  assert.equal((await post(guest.token, [id, 'claims'], { itemId, units: 0 })).status, 410);
});
