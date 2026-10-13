import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useBills } from '../src/lib/store';
const data = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) } });
test('incomplete drafts survive hydration and corrupted originals cannot be overwritten', () => {
  useBills.getState().start();
  const draftId = useBills.getState().draft?.id;
  useBills.setState({ draft: null }); useBills.getState().hydrate();
  assert.equal(useBills.getState().draft?.id, draftId);
  assert.equal(useBills.getState().draft?.items.length, 0);
  data.set('bagiyuk.v1', '{broken-json'); useBills.getState().hydrate();
  assert.ok(useBills.getState().storageError);
  useBills.getState().start();
  assert.equal(data.get('bagiyuk.v1'), '{broken-json');
});
