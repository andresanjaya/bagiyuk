import { z } from 'zod';
const money = z.number().int().min(0).max(1_000_000_000);
export const itemSchema = z.object({ id: z.string(), name: z.string().trim().min(1).max(80), quantity: z.number().int().min(1).max(1000), price: money, discount: money, assigned: z.array(z.string()).max(8) }).refine(i => i.discount <= i.price * i.quantity, 'Diskon melebihi harga item.');
export const personSchema = z.object({ id: z.string(), name: z.string().trim().min(1).max(40), phone: z.string().max(30) });
export const billSchema = z.object({ id: z.string(), name: z.string().trim().min(1).max(80), category: z.string(), source: z.enum(['manual', 'receipt']), date: z.string().datetime(), items: z.array(itemSchema).min(1).max(100), people: z.array(personSchema).min(1).max(8), host: z.string(), tax: money, service: money, discount: money, tip: money, rounding: z.number().int().min(-10000).max(10000), equal: z.boolean() });
export type Item = z.infer<typeof itemSchema>;
export type Person = z.infer<typeof personSchema>;
export type Bill = z.infer<typeof billSchema>;
export const draftSchema = billSchema.extend({ name: z.string().max(80), items: z.array(itemSchema).max(100) });
export const id = () => crypto.randomUUID();
export const rupiah = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
export const itemTotal = (item: Item) => item.quantity * item.price - item.discount;
export const subtotal = (b: Bill) => b.items.reduce((s, i) => s + itemTotal(i), 0);
export const total = (b: Bill) => subtotal(b) + b.tax + b.service + b.tip - b.discount + b.rounding;
export function freshBill(): Bill { const host = id(); return { id: id(), name: '', category: 'Makan & minum', source: 'manual', date: new Date().toISOString(), items: [], people: [{ id: host, name: 'Kamu', phone: '' }], host, tax: 0, service: 0, discount: 0, tip: 0, rounding: 0, equal: false }; }
// Integer remainders are distributed deterministically; every rupiah stays accounted for.
export function allocate(amount: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map(() => 0);
  const sign = Math.sign(amount);
  const denominator = BigInt(sum);
  const products = weights.map(w => BigInt(Math.abs(amount)) * BigInt(w));
  const values = products.map(p => Number(p / denominator));
  const order = products.map((p, i) => ({ i, remainder: p % denominator })).sort((a, b) => a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1);
  const remainder = Math.abs(amount) - values.reduce((a, b) => a + b, 0);
  for (let i = 0; i < remainder; i++) values[order[i].i]++;
  return values.map(v => sign * v);
}
export function calculate(input: Bill) {
  const b = billSchema.parse(input);
  if (subtotal(b) > 1_000_000_000_000) throw new Error('Total tagihan melebihi batas Rp1 triliun.');
  if (new Set(b.people.map(p => p.id)).size !== b.people.length || !b.people.some(p => p.id === b.host)) throw new Error('Peserta atau pembayar tidak valid.');
  if (new Set(b.items.map(i => i.id)).size !== b.items.length) throw new Error('Item duplikat.');
  if (total(b) < 0 || subtotal(b) - b.discount < 0) throw new Error('Diskon atau pembulatan terlalu besar.');
  let weights = b.people.map(() => 0);
  if (b.equal) weights = b.people.map(() => 1);
  else for (const item of b.items) {
    if (!item.assigned.length || new Set(item.assigned).size !== item.assigned.length || item.assigned.some(p => !b.people.some(person => person.id === p))) throw new Error('Pilih peserta untuk semua item dulu, ya.');
    // Eight participants have a common denominator of 840, preserving exact shared proportions.
    weights = weights.map((w, i) => w + (item.assigned.includes(b.people[i].id) ? itemTotal(item) * (840 / item.assigned.length) : 0));
  }
  if (weights.every(w => w === 0)) weights = b.people.map(() => 1);
  const base = allocate(subtotal(b), weights);
  const tax = allocate(b.tax, weights), service = allocate(b.service, weights), tip = allocate(b.tip, weights), discount = allocate(-b.discount, weights), rounding = allocate(b.rounding, weights);
  const finals = allocate(total(b), weights);
  return b.people.map((person, i) => ({ ...person, subtotal: base[i], tax: tax[i], service: service[i], tip: tip[i], discount: discount[i], rounding: rounding[i] + finals[i] - (base[i] + tax[i] + service[i] + tip[i] + discount[i] + rounding[i]), amount: finals[i], items: b.equal ? b.items : b.items.filter(item => item.assigned.includes(person.id)) }));
}
export function summaryText(b: Bill) {
  const host = b.people.find(p => p.id === b.host)?.name;
  return `Patungan? Bagiyuk.\n${b.name}\n${new Date(b.date).toLocaleDateString('id-ID')}\n\n${calculate(b).map(p => `${p.name}: ${rupiah(p.amount)}\n${p.items.map(i => `  • ${i.name}${!b.equal && i.assigned.length > 1 ? ' (berbagi)' : ''}`).join('\n')}`).join('\n\n')}\n\nSubtotal: ${rupiah(subtotal(b))}\nPajak: ${rupiah(b.tax)}\nService: ${rupiah(b.service)}\nTip: ${rupiah(b.tip)}\nDiskon: ${rupiah(b.discount)}\nPembulatan: ${rupiah(b.rounding)}\nTotal: ${rupiah(total(b))}\nDibayar dulu oleh ${host}.\nMakasih, ya!`;
}
