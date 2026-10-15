// Run against a dedicated Supabase test project with all three migrations applied.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { GET, POST } from '../src/app/api/split/[...path]/route';
import { freshBill } from '../src/lib/bill';
import { finalizedAmounts, type Room } from '../src/lib/split';

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
    const column = table === 'split_sessions' ? 'id' : 'session_id';
    const before = await admin.from(table).select('*').eq(column, id);
    await guest.client.from(table).update(patch).eq(column, id);
    const after = await admin.from(table).select('*').eq(column, id);
    assert.deepEqual(after.data, before.data, `${table} allowed direct writes`);
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

test('two identities receive realtime updates, finalize once, and persist host-only payment status', async () => {
  const host = await actor(), guest = await actor(), stranger = await actor();
  const bill = freshBill(); bill.name = 'Finalization test'; bill.items = [{ id: crypto.randomUUID(), name: 'Nasi', quantity: 2, price: 12000, discount: 0, assigned: [] }]; bill.discount = 1000; bill.tax = 1000;
  const created = await post(host.token, ['sessions'], { bill, hostName: 'Host' });
  assert.equal(created.status, 200);
  const id = created.data.sessionId;
  const invitation = await post(host.token, [id, 'invites'], {});
  assert.equal((await post(guest.token, ['join'], { token: invitation.data.url.split('/').pop(), name: 'Guest' })).status, 200);
  const items = await host.client.from('split_session_items').select('id').eq('session_id', id);
  const people = await host.client.from('split_participants').select('*').eq('session_id', id);
  assert.ifError(items.error); assert.ifError(people.error);
  const itemId = items.data![0].id, guestId = people.data!.find(p => p.role === 'guest')!.id;
  assert.equal((await post(host.token, [id, 'open'], {})).status, 200);
  assert.equal((await post(host.token, [id, 'finalize'], {})).status, 409);

  let changed!: () => void;
  const observed = new Promise<void>(resolve => { changed = resolve; });
  const channel = guest.client.channel(`test-${id}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'split_sessions', filter: `id=eq.${id}` }, () => changed());
  try {
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Realtime subscription timed out')), 10000); channel.subscribe(status => { if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); } }); });
    assert.equal((await post(host.token, [id, 'claims'], { itemId, units: 1 })).status, 200);
    await Promise.race([observed, new Promise((_, reject) => setTimeout(() => reject(new Error('Guest did not receive a room update')), 10000))]);
  } finally { await guest.client.removeChannel(channel); }
  assert.equal((await post(guest.token, [id, 'claims'], { itemId, units: 1 })).status, 200);
  assert.equal((await post(guest.token, [id, 'finalize'], {})).status, 403);
  const [session, allItems, allClaims] = await Promise.all([
    admin.from('split_sessions').select('*').eq('id', id).single(),
    admin.from('split_session_items').select('*').eq('session_id', id),
    admin.from('split_item_claims').select('*').eq('session_id', id),
  ]);
  assert.ifError(session.error); assert.ifError(allItems.error); assert.ifError(allClaims.error);
  const rows = finalizedAmounts({ session: session.data, items: allItems.data, participants: people.data, claims: allClaims.data, summaries: [], settlements: [], contributions: [], transfers: [], me: '' } as Room);
  const stale = await admin.rpc('split_finalize', { p_user: (await host.client.auth.getUser()).data.user!.id, p_session: id, p_expected_version: session.data!.version - 1, p_rows: rows });
  assert.equal(stale.error?.message, 'VERSION_CONFLICT');
  assert.equal((await post(host.token, [id, 'finalize'], {})).status, 200);
  assert.equal((await post(host.token, [id, 'finalize'], {})).status, 200);
  assert.equal((await post(guest.token, [id, 'claims'], { itemId, units: 0 })).status, 409);
  const summaries = await guest.client.from('split_finalized_summaries').select('*').eq('session_id', id);
  const payments = await guest.client.from('split_settlements').select('*').eq('session_id', id);
  assert.ifError(summaries.error); assert.ifError(payments.error);
  assert.equal(summaries.data!.reduce((n, row) => n + Number(row.final_amount), 0), 24000);
  assert.equal(payments.data!.find(row => row.participant_id === guestId)?.status, 'unpaid');
  assert.deepEqual((await stranger.client.from('split_settlements').select('*').eq('session_id', id)).data, []);
  await guest.client.from('split_settlements').update({ status: 'paid' }).eq('session_id', id);
  assert.equal((await admin.from('split_settlements').select('status').eq('session_id', id).eq('participant_id', guestId).single()).data?.status, 'unpaid');
  assert.equal((await post(guest.token, [id, 'settlements'], { participantId: guestId, status: 'paid' })).status, 403);
  assert.equal((await post(host.token, [id, 'settlements'], { participantId: guestId, status: 'paid' })).status, 200);
  assert.equal((await guest.client.from('split_settlements').select('status,paid_at').eq('session_id', id).eq('participant_id', guestId).single()).data?.status, 'paid');
  assert.equal((await post(host.token, [id, 'settlements'], { participantId: guestId, status: 'unpaid' })).status, 200);
  assert.equal((await guest.client.from('split_settlements').select('status,paid_at').eq('session_id', id).eq('participant_id', guestId).single()).data?.paid_at, null);
});

test('private group, two upfront payers, realtime transfer status, and host-only status', async () => {
  const host = await actor(), budi = await actor(), citra = await actor(), stranger = await actor();
  const members = [{ id: crypto.randomUUID(), display_name: 'Budi' }, { id: crypto.randomUUID(), display_name: 'Citra' }];
  const saved = await host.client.rpc('split_group_save', { p_group: null, p_name: 'Weekend Crew', p_members: members });
  assert.ifError(saved.error); const groupId = saved.data as string;
  assert.equal((await host.client.from('friend_group_members').select('id').eq('group_id', groupId)).data?.length, 2);
  assert.deepEqual((await budi.client.from('friend_groups').select('id').eq('id', groupId)).data, []);
  assert.deepEqual((await budi.client.from('friend_group_members').select('id').eq('group_id', groupId)).data, []);
  assert.ok((await budi.client.rpc('split_group_archive', { p_group: groupId })).error);
  assert.ok((await budi.client.rpc('split_group_save', { p_group: groupId, p_name: 'Stolen', p_members: [] })).error);
  const bill = freshBill(); bill.groupId = groupId; bill.name = 'Makan Bareng';
  bill.items = [['Andre', 100000], ['Budi', 80000], ['Citra', 60000]].map(([name, price]) => ({ id: crypto.randomUUID(), name: String(name), quantity: 1, price: Number(price), discount: 0, assigned: [] }));
  const created = await post(host.token, ['sessions'], { bill, hostName: 'Andre' });
  assert.equal(created.status, 200); const id = created.data.sessionId;
  assert.equal((await host.client.from('split_sessions').select('group_id').eq('id', id).single()).data?.group_id, groupId);
  const invite = await post(host.token, [id, 'invites'], {}); const token = invite.data.url.split('/').pop();
  assert.equal((await post(budi.token, ['join'], { token, name: 'Budi' })).status, 200);
  assert.equal((await post(citra.token, ['join'], { token, name: 'Citra' })).status, 200);
  assert.equal((await post(host.token, [id, 'open'], {})).status, 200);
  const people = (await host.client.from('split_participants').select('*').eq('session_id', id)).data!;
  const items = (await host.client.from('split_session_items').select('*').eq('session_id', id)).data!;
  const byRole = (role: string) => people.find(p => p.display_name === role)!.id;
  assert.equal((await post(host.token, [id, 'claims'], { itemId: items.find(i => i.name === 'Andre')!.id, units: 1 })).status, 200);
  assert.equal((await post(budi.token, [id, 'claims'], { itemId: items.find(i => i.name === 'Budi')!.id, units: 1 })).status, 200);
  assert.equal((await post(citra.token, [id, 'claims'], { itemId: items.find(i => i.name === 'Citra')!.id, units: 1 })).status, 200);
  const version = async () => (await host.client.from('split_sessions').select('version').eq('id', id).single()).data!.version;
  const rows = (budiAmount: number) => [{ participantId: byRole('Andre'), amount: 180000 }, { participantId: byRole('Budi'), amount: budiAmount }, { participantId: byRole('Citra'), amount: 0 }];
  assert.equal((await post(budi.token, [id, 'contributions'], { expectedVersion: await version(), rows: rows(60000) })).status, 403);
  assert.equal((await post(host.token, [id, 'contributions'], { expectedVersion: await version(), rows: rows(59000) })).status, 200);
  assert.equal((await post(host.token, [id, 'finalize'], {})).status, 409);
  assert.equal((await post(host.token, [id, 'contributions'], { expectedVersion: await version(), rows: rows(61000) })).status, 200);
  assert.equal((await post(host.token, [id, 'finalize'], {})).status, 409);
  assert.equal((await post(host.token, [id, 'contributions'], { expectedVersion: await version(), rows: rows(60000) })).status, 200);
  assert.equal((await post(host.token, [id, 'finalize'], {})).status, 200);
  assert.equal((await post(host.token, [id, 'finalize'], {})).status, 200);
  const transfers = (await budi.client.from('split_transfers').select('*').eq('session_id', id)).data!;
  assert.deepEqual(transfers.map(t => ({ from: t.from_participant_id, to: t.to_participant_id, amount: Number(t.amount_idr) })).sort((a,b) => a.amount - b.amount), [
    { from: byRole('Budi'), to: byRole('Andre'), amount: 20000 },
    { from: byRole('Citra'), to: byRole('Andre'), amount: 60000 },
  ]);
  assert.deepEqual((await stranger.client.from('split_transfers').select('id').eq('session_id', id)).data, []);
  await budi.client.from('split_transfers').update({ status: 'paid' }).eq('id', transfers[0].id);
  assert.equal((await admin.from('split_transfers').select('status').eq('id', transfers[0].id).single()).data?.status, 'unpaid');
  assert.equal((await post(budi.token, [id, 'transfers'], { transferId: transfers[0].id, status: 'paid' })).status, 403);
  assert.equal((await post(host.token, [id, 'transfers'], { transferId: transfers[0].id, status: 'paid', amount: 1 })).status, 400);
  let sawUpdate!: () => void;
  const updated = new Promise<void>(resolve => { sawUpdate = resolve; });
  const channel = budi.client.channel(`transfer-${id}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'split_sessions', filter: `id=eq.${id}` }, () => sawUpdate());
  try {
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Transfer realtime subscription timed out')), 10000); channel.subscribe(status => { if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); } }); });
    assert.equal((await post(host.token, [id, 'transfers'], { transferId: transfers[0].id, status: 'paid' })).status, 200);
    await Promise.race([updated, new Promise((_, reject) => setTimeout(() => reject(new Error('Guest did not receive transfer status update')), 10000))]);
  } finally { await budi.client.removeChannel(channel); }
  assert.equal((await post(host.token, [id, 'transfers'], { transferId: transfers[0].id, status: 'paid' })).status, 200);
  assert.equal((await budi.client.from('split_transfers').select('status').eq('id', transfers[0].id).single()).data?.status, 'paid');
  assert.equal((await host.client.from('split_transfer_events').select('id').eq('transfer_id', transfers[0].id)).data?.length, 1);
  assert.equal((await post(host.token, [id, 'transfers'], { transferId: transfers[0].id, status: 'unpaid' })).status, 200);
  assert.equal((await host.client.from('split_transfer_events').select('id').eq('transfer_id', transfers[0].id)).data?.length, 2);
  assert.equal((await host.client.from('split_finalized_summaries').select('final_amount').eq('session_id', id)).data?.reduce((sum: number, row: { final_amount: number }) => sum + Number(row.final_amount), 0), 240000);
  assert.ifError((await host.client.rpc('split_group_archive', { p_group: groupId })).error);
  assert.equal((await host.client.from('friend_groups').select('archived_at').eq('id', groupId).single()).data?.archived_at !== null, true);
  assert.equal((await host.client.from('split_sessions').select('group_id').eq('id', id).single()).data?.group_id, groupId);
});
