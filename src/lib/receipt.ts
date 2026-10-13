import { z } from 'zod';
const amount = z.number().int().nonnegative().max(1_000_000_000);
export const receiptSchema = z.object({
  merchant_name: z.string().trim().min(1).max(80), date: z.string().nullable(), currency: z.literal('IDR'),
  items: z.array(z.object({ name: z.string().trim().min(1).max(80), quantity: z.number().int().min(1).max(1000), unit_price: amount, discount: amount, total_price: amount }).refine(i => i.unit_price * i.quantity - i.discount === i.total_price, 'Harga item tidak cocok.')).min(1).max(100),
  subtotal: amount, service_charge: amount, tax: amount, discount: amount, grand_total: amount,
});
