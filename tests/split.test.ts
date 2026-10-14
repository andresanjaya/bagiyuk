import assert from 'node:assert/strict';
import { test } from 'node:test';
import { freshBill } from '../src/lib/bill';
import { claimSchema, joinSchema, roomAmounts, validatedSnapshot, type Room } from '../src/lib/split';

function room(): Room {
  return { session: { id: 's', host_user_id: 'u1', title: 'Makan', state: 'claiming', subtotal_amount: 40001, discount_amount: 1000, service_amount: 500, tax_amount: 2000, tip_amount: 0, rounding_amount: 0, grand_total_amount: 41501, expires_at: '2099-01-01', max_participants: 12 }, items: [{ id: 'tea', session_id: 's', name: 'Tea', quantity: 3, total_amount: 10000, allocation_mode: 'exclusive', sort_order: 0 }, { id: 'fries', session_id: 's', name: 'Fries', quantity: 1, total_amount: 30001, allocation_mode: 'shared', sort_order: 1 }], participants: ['a','b','c'].map((id, i) => ({ id, session_id: 's', user_id: `u${i+1}`, display_name: id, role: i ? 'guest' : 'host' })), claims: [], me: 'u1' };
}
test('exclusive units and shared members account for every integer rupiah', () => {
  const r = room();
  r.claims = [{ item_id: 'tea', participant_id: 'a', claimed_units: 1, is_shared_member: false }, { item_id: 'tea', participant_id: 'b', claimed_units: 2, is_shared_member: false }, ...['a','b','c'].map(participant_id => ({ item_id: 'fries', participant_id, claimed_units: 0, is_shared_member: true }))];
  const result = roomAmounts(r);
  assert.equal(result.covered, 4);
  assert.equal(result.assignable, 4);
  assert.equal(result.people.reduce((n, p) => n + p.itemAmount, 0), 40001);
  assert.equal(result.people.reduce((n, p) => n + p.estimate, 0), 41501);
  r.claims = r.claims.filter(c => c.participant_id !== 'c');
  assert.equal(roomAmounts(r).people.find(p => p.id === 'a')?.itemAmount, 18335);
});
test('unclaimed shared item stays unresolved', () => { const r = room(); assert.equal(roomAmounts(r).covered, 0); assert.equal(roomAmounts(r).assignable, 4); });
test('unclaimed items do not push all bill fees onto the first claimer', () => { const r = room(); r.claims = [{ item_id: 'tea', participant_id: 'a', claimed_units: 1, is_shared_member: false }]; const estimate = roomAmounts(r).people.find(p => p.id === 'a')!.estimate; assert.ok(estimate > 3333 && estimate < 4000); });
test('cloud snapshot copies money and omits local people and assignments', () => {
  const b = freshBill(); b.name = 'Lunch'; b.items = [{ id: 'tea', name: 'Tea', quantity: 3, price: 4000, discount: 1, assigned: [b.host] }]; b.tax = 1000;
  const snapshot = validatedSnapshot(b);
  assert.equal(snapshot.items[0].total_amount, 11999);
  assert.equal(snapshot.grand_total_amount, 12999);
  assert.ok(!JSON.stringify(snapshot).includes('assigned'));
  assert.deepEqual(b.items[0].assigned, [b.host]);
});
test('join and claim inputs reject malformed values', () => {
  assert.equal(joinSchema.safeParse({ token: 'short', name: 'A' }).success, false);
  assert.equal(joinSchema.safeParse({ token: 'a'.repeat(64), name: ' ' }).success, false);
  assert.equal(claimSchema.safeParse({ itemId: 'bad', units: 1 }).success, false);
  assert.equal(claimSchema.safeParse({ itemId: '00000000-0000-4000-8000-000000000001', units: -1 }).success, false);
});
