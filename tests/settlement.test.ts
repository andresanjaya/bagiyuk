import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settlementPlan } from '../src/lib/settlement';

test('one upfront payer reproduces guest-to-host debts', () => {
  assert.deepEqual(settlementPlan([{ participantId: 'host', amount: 100 }, { participantId: 'b', amount: 80 }, { participantId: 'c', amount: 60 }], [{ participantId: 'host', amount: 240 }], 240), [
    { fromParticipantId: 'b', toParticipantId: 'host', amount: 80 },
    { fromParticipantId: 'c', toParticipantId: 'host', amount: 60 },
  ]);
});

test('two upfront payers produce the specified exact transfers', () => {
  assert.deepEqual(settlementPlan([{ participantId: 'andre', amount: 100000 }, { participantId: 'budi', amount: 80000 }, { participantId: 'citra', amount: 60000 }], [{ participantId: 'andre', amount: 180000 }, { participantId: 'budi', amount: 60000 }], 240000), [
    { fromParticipantId: 'citra', toParticipantId: 'andre', amount: 60000 },
    { fromParticipantId: 'budi', toParticipantId: 'andre', amount: 20000 },
  ]);
});

test('own-share, one-person and zero-cost bills need no transfers', () => {
  assert.deepEqual(settlementPlan([{ participantId: 'a', amount: 7 }, { participantId: 'b', amount: 9 }], [{ participantId: 'a', amount: 7 }, { participantId: 'b', amount: 9 }], 16), []);
  assert.deepEqual(settlementPlan([{ participantId: 'a', amount: 9 }], [{ participantId: 'a', amount: 9 }], 9), []);
  assert.deepEqual(settlementPlan([{ participantId: 'a', amount: 0 }], [], 0), []);
});

test('invalid money, duplicate IDs and under/overpayment are rejected', () => {
  const shares = [{ participantId: 'a', amount: 5 }, { participantId: 'b', amount: 5 }];
  for (const amount of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, 9, 11]) assert.throws(() => settlementPlan(shares, [{ participantId: 'a', amount }], 10));
  assert.throws(() => settlementPlan(shares, [{ participantId: 'a', amount: 10 }, { participantId: 'a', amount: 0 }], 10));
  assert.throws(() => settlementPlan(shares, [{ participantId: 'outsider', amount: 10 }], 10));
});

test('ties and multiple creditors are deterministic and conserve every rupiah', () => {
  const shares = [{ participantId: 'a', amount: 10 }, { participantId: 'b', amount: 10 }, { participantId: 'c', amount: 10 }, { participantId: 'd', amount: 10 }];
  const contributions = [{ participantId: 'a', amount: 20 }, { participantId: 'b', amount: 20 }];
  const first = settlementPlan(shares, contributions, 40);
  assert.deepEqual(first, [{ fromParticipantId: 'c', toParticipantId: 'a', amount: 10 }, { fromParticipantId: 'd', toParticipantId: 'b', amount: 10 }]);
  assert.deepEqual(settlementPlan(shares, contributions, 40), first);
  assert.equal(first.reduce((sum, row) => sum + row.amount, 0), 20);
  assert.equal(new Set(first.map(row => `${row.fromParticipantId}:${row.toParticipantId}`)).size, first.length);
});
