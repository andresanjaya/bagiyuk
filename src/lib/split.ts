import { z } from 'zod';
import { allocate, billSchema, itemTotal, subtotal, total, type Bill } from './bill';

export const createSchema = z.object({ bill: billSchema, hostName: z.string().trim().min(1).max(40) }).strict();
export const joinSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), name: z.string().trim().min(1).max(40) }).strict();
export const claimSchema = z.object({ itemId: z.string().uuid(), units: z.number().int().min(0).max(1000).optional(), shared: z.boolean().optional() }).strict();
export const hostClaimSchema = claimSchema.extend({ participantId: z.string().uuid() });
export const modeSchema = z.object({ itemId: z.string().uuid(), mode: z.enum(['exclusive', 'shared']) }).strict();
export const settlementSchema = z.object({ participantId: z.string().uuid(), status: z.enum(['paid', 'unpaid']) }).strict();
export const contributionSchema = z.object({ expectedVersion: z.number().int().positive(), rows: z.array(z.object({ participantId: z.string().uuid(), amount: z.number().int().min(0).max(1_000_000_000_000) }).strict()).min(1).max(12) }).strict();
export const transferStatusSchema = z.object({ transferId: z.string().uuid(), status: z.enum(['paid', 'unpaid']) }).strict();

export type Session = { id: string; host_user_id: string; group_id: string | null; title: string; state: 'draft' | 'claiming' | 'finalized' | 'closed'; version: number; subtotal_amount: number; discount_amount: number; service_amount: number; tax_amount: number; tip_amount: number; rounding_amount: number; grand_total_amount: number; expires_at: string; max_participants: number };
export type SessionItem = { id: string; session_id: string; name: string; quantity: number; total_amount: number; allocation_mode: 'exclusive' | 'shared'; sort_order: number };
export type Participant = { id: string; session_id: string; user_id: string; display_name: string; role: 'host' | 'guest' };
export type Claim = { item_id: string; participant_id: string; claimed_units: number; is_shared_member: boolean };
export type FinalSummary = { participant_id: string; item_amount: number; discount_share: number; service_share: number; tax_share: number; tip_share: number; rounding_share: number; final_amount: number };
export type Settlement = { participant_id: string; amount_due: number; status: 'paid' | 'unpaid'; paid_at: string | null; marked_by_user_id: string | null };
export type UpfrontContribution = { participant_id: string; amount_idr: number };
export type Transfer = { id: string; from_participant_id: string; to_participant_id: string; amount_idr: number; status: 'paid' | 'unpaid'; paid_at: string | null };
export type Room = { session: Session; items: SessionItem[]; participants: Participant[]; claims: Claim[]; summaries: FinalSummary[]; settlements: Settlement[]; contributions: UpfrontContribution[]; transfers: Transfer[]; me: string };

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

export function finalizedAmounts(room: Room): FinalSummary[] {
  if (room.session.state !== 'claiming') throw new Error('ROOM_NOT_CLAIMING');
  const split = roomAmounts(room);
  if (!split.people.length || !room.items.length || split.covered !== split.assignable) throw new Error('INCOMPLETE_ALLOCATION');
  const subtotalAmount = room.items.reduce((sum, item) => sum + item.total_amount, 0);
  if (subtotalAmount !== room.session.subtotal_amount || split.people.reduce((sum, person) => sum + person.itemAmount, 0) !== subtotalAmount) throw new Error('TOTAL_MISMATCH');
  const s = room.session;
  if (s.grand_total_amount !== subtotalAmount - s.discount_amount + s.service_amount + s.tax_amount + s.tip_amount + s.rounding_amount) throw new Error('TOTAL_MISMATCH');
  const weights = split.people.map(person => person.itemAmount);
  const shares = (amount: number) => allocate(amount, weights.some(Boolean) ? weights : weights.map(() => 1));
  const discount = shares(-s.discount_amount), service = shares(s.service_amount), tax = shares(s.tax_amount), tip = shares(s.tip_amount), rounding = shares(s.rounding_amount);
  const rows = split.people.map((person, i) => ({ participant_id: person.id, item_amount: person.itemAmount, discount_share: discount[i], service_share: service[i], tax_share: tax[i], tip_share: tip[i], rounding_share: rounding[i], final_amount: person.itemAmount + discount[i] + service[i] + tax[i] + tip[i] + rounding[i] }));
  if (rows.some(row => !Number.isSafeInteger(row.final_amount) || row.final_amount < 0) || rows.reduce((sum, row) => sum + row.final_amount, 0) !== s.grand_total_amount) throw new Error('TOTAL_MISMATCH');
  return rows;
}
