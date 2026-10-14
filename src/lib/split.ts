import { z } from 'zod';
import { allocate, billSchema, itemTotal, subtotal, total, type Bill } from './bill';

export const createSchema = z.object({ bill: billSchema, hostName: z.string().trim().min(1).max(40) }).strict();
export const joinSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), name: z.string().trim().min(1).max(40) }).strict();
export const claimSchema = z.object({ itemId: z.string().uuid(), units: z.number().int().min(0).max(1000).optional(), shared: z.boolean().optional() }).strict();
export const hostClaimSchema = claimSchema.extend({ participantId: z.string().uuid() });
export const modeSchema = z.object({ itemId: z.string().uuid(), mode: z.enum(['exclusive', 'shared']) }).strict();

export type Session = { id: string; host_user_id: string; title: string; state: 'draft' | 'claiming' | 'finalized' | 'closed'; subtotal_amount: number; discount_amount: number; service_amount: number; tax_amount: number; tip_amount: number; rounding_amount: number; grand_total_amount: number; expires_at: string; max_participants: number };
export type SessionItem = { id: string; session_id: string; name: string; quantity: number; total_amount: number; allocation_mode: 'exclusive' | 'shared'; sort_order: number };
export type Participant = { id: string; session_id: string; user_id: string; display_name: string; role: 'host' | 'guest' };
export type Claim = { item_id: string; participant_id: string; claimed_units: number; is_shared_member: boolean };
export type Room = { session: Session; items: SessionItem[]; participants: Participant[]; claims: Claim[]; me: string };

export function validatedSnapshot(bill: Bill) {
  const b = billSchema.parse(bill);
  if (new Set(b.items.map(i => i.id)).size !== b.items.length || !Number.isSafeInteger(total(b)) || total(b) < 0 || subtotal(b) < b.discount) throw new Error('Periksa item dan total tagihan.');
  return { source_local_bill_id: b.id, title: b.name, subtotal_amount: subtotal(b), discount_amount: b.discount, service_amount: b.service, tax_amount: b.tax, tip_amount: b.tip, rounding_amount: b.rounding, grand_total_amount: total(b), items: b.items.map((i, sort_order) => ({ source_item_id: i.id, name: i.name, quantity: i.quantity, total_amount: itemTotal(i), sort_order })) };
}

export function roomAmounts(room: Room) {
  const people = [...room.participants].sort((a, b) => a.id.localeCompare(b.id));
  const amounts = new Map(people.map(p => [p.id, 0]));
  let covered = 0, assignable = 0;
  for (const item of room.items) {
    const claims = room.claims.filter(c => c.item_id === item.id);
    if (item.allocation_mode === 'shared') {
      assignable++;
      const members = claims.filter(c => c.is_shared_member).sort((a, b) => a.participant_id.localeCompare(b.participant_id));
      if (members.length) covered++;
      allocate(item.total_amount, members.map(() => 1)).forEach((value, i) => amounts.set(members[i].participant_id, (amounts.get(members[i].participant_id) ?? 0) + value));
    } else {
      assignable += item.quantity;
      const units = claims.reduce((n, c) => n + c.claimed_units, 0);
      covered += units;
      const sorted = [...claims].sort((a, b) => a.participant_id.localeCompare(b.participant_id));
      let offset = 0;
      const portions = allocate(item.total_amount, Array(item.quantity).fill(1));
      for (const claim of sorted) { const value = portions.slice(offset, offset + claim.claimed_units).reduce((a, b) => a + b, 0); amounts.set(claim.participant_id, (amounts.get(claim.participant_id) ?? 0) + value); offset += claim.claimed_units; }
    }
  }
  const weights = people.map(p => amounts.get(p.id) ?? 0);
  const fees = room.session.tax_amount + room.session.service_amount + room.session.tip_amount + room.session.rounding_amount - room.session.discount_amount;
  const claimedAmount = weights.reduce((a, b) => a + b, 0);
  const estimatedFees = room.session.subtotal_amount ? allocate(fees, [claimedAmount, Math.max(0, room.session.subtotal_amount - claimedAmount)])[0] : covered === assignable ? fees : 0;
  const allocated = allocate(estimatedFees, weights.some(Boolean) ? weights : people.map(() => 1));
  return { covered, assignable, people: people.map((p, i) => ({ ...p, itemAmount: weights[i], estimate: weights[i] + allocated[i] })) };
}
