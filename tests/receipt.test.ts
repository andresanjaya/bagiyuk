import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { POST } from '../src/app/api/receipt/route';
import { receiptSchema } from '../src/lib/receipt';
const fixture = { merchant_name: 'Kafe test', date: null, currency: 'IDR', items: [{ name: 'Kopi', quantity: 2, unit_price: 25000, discount: 0, total_price: 50000 }], subtotal: 50000, service_charge: 0, tax: 5000, discount: 0, grand_total: 55000 };
test('receipt output rejects inconsistent line prices and unsupported currency', () => { assert.equal(receiptSchema.safeParse(fixture).success, true); assert.equal(receiptSchema.safeParse({ ...fixture, currency: 'USD' }).success, false); assert.equal(receiptSchema.safeParse({ ...fixture, items: [{ ...fixture.items[0], total_price: 1 }] }).success, false); });
test('scan API handles absent config, invalid file and valid extraction without a live AI call', async () => {
  const oldKey = process.env.GEMINI_API_KEY; const oldFetch = globalThis.fetch;
  const makeRequest = (ip: string, type = 'image/jpeg', origin = 'http://localhost:3000') => { const form = new FormData(); form.set('receipt', new File([new Uint8Array([255, 216, 255, 224])], 'receipt.jpg', { type })); return new NextRequest('http://localhost:3000/api/receipt', { method: 'POST', body: form, headers: { origin, 'content-length': '500', 'x-forwarded-for': ip } }); };
  try {
    delete process.env.GEMINI_API_KEY;
    assert.equal((await POST(makeRequest('missing'))).status, 503);
    assert.equal((await POST(makeRequest('foreign', 'image/jpeg', 'https://other.example'))).status, 403);
    process.env.GEMINI_API_KEY = 'test-only-key';
    assert.equal((await POST(makeRequest('invalid', 'text/plain'))).status, 400);
    globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(fixture) }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const response = await POST(makeRequest('valid')); assert.equal(response.status, 200); assert.deepEqual(await response.json(), fixture);
    assert.equal((await POST(makeRequest('valid'))).status, 429);
    globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"bad":true}' }] } }] }), { status: 200 });
    assert.equal((await POST(makeRequest('bad-output'))).status, 422);
  } finally { globalThis.fetch = oldFetch; if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey; }
});
