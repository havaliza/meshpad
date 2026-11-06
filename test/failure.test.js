import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFailure } from '../src/failure.js';

test('failure modes reject invalid or unusable resource settings', () => {
  for (const config of [null, 'hearts', {}, { type: 'unknown' }, ...[0, 2, 6, 3.5, NaN].map((hearts) => ({ type: 'hearts', hearts })),
    ...[0, -1, Infinity, NaN, '30', undefined].flatMap((seconds) => [{ type: 'time', seconds }, { type: 'time', seconds: 30, playOnSeconds: seconds === undefined ? 0 : seconds }]),
    ...[0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '10', undefined].flatMap((moves) => [{ type: 'moves', moves }, { type: 'moves', moves: 10, playOnMoves: moves === undefined ? 0 : moves }]),
  ]) assert.throws(() => createFailure(config), { name: /TypeError|RangeError/ });
});
