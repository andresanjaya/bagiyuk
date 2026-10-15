export type Share = { participantId: string; amount: number };
export type Contribution = { participantId: string; amount: number };
export type TransferPlan = { fromParticipantId: string; toParticipantId: string; amount: number };

export function settlementPlan(shares: Share[], contributions: Contribution[], grandTotal: number): TransferPlan[] {
  if (!Number.isSafeInteger(grandTotal) || grandTotal < 0 || !shares.length) throw new Error('INVALID_TOTAL');
  const ids = new Set(shares.map(row => row.participantId));
  if (ids.size !== shares.length || shares.some(row => !row.participantId || !Number.isSafeInteger(row.amount) || row.amount < 0)) throw new Error('INVALID_SHARE');
  if (new Set(contributions.map(row => row.participantId)).size !== contributions.length || contributions.some(row => !ids.has(row.participantId) || !Number.isSafeInteger(row.amount) || row.amount < 0)) throw new Error('INVALID_CONTRIBUTION');
  if (shares.reduce((sum, row) => sum + row.amount, 0) !== grandTotal || contributions.reduce((sum, row) => sum + row.amount, 0) !== grandTotal || (grandTotal > 0 && !contributions.some(row => row.amount > 0))) throw new Error('TOTAL_MISMATCH');
  const paid = new Map(contributions.map(row => [row.participantId, row.amount]));
  const balances = shares.map(row => ({ id: row.participantId, net: (paid.get(row.participantId) ?? 0) - row.amount }));
  if (balances.reduce((sum, row) => sum + row.net, 0) !== 0) throw new Error('TOTAL_MISMATCH');
  const debtors = balances.filter(row => row.net < 0).map(row => ({ id: row.id, remaining: -row.net })).sort((a, b) => b.remaining - a.remaining || a.id.localeCompare(b.id));
  const creditors = balances.filter(row => row.net > 0).map(row => ({ id: row.id, remaining: row.net })).sort((a, b) => b.remaining - a.remaining || a.id.localeCompare(b.id));
  const transfers: TransferPlan[] = [];
  let d = 0, c = 0;
  while (d < debtors.length && c < creditors.length) {
    const amount = Math.min(debtors[d].remaining, creditors[c].remaining);
    if (amount > 0 && debtors[d].id !== creditors[c].id) transfers.push({ fromParticipantId: debtors[d].id, toParticipantId: creditors[c].id, amount });
    debtors[d].remaining -= amount; creditors[c].remaining -= amount;
    if (!debtors[d].remaining) d++;
    if (!creditors[c].remaining) c++;
  }
  if (d !== debtors.length || c !== creditors.length || transfers.reduce((sum, row) => sum + row.amount, 0) !== balances.filter(row => row.net < 0).reduce((sum, row) => sum - row.net, 0)) throw new Error('TOTAL_MISMATCH');
  return transfers;
}
