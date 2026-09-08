import assert from 'node:assert/strict';
import test from 'node:test';
import { wordmarkMotion } from '../public/wordmark-canvas.js';

const geometry = { rows: 43, width: 92, period: 36.8, waveOpacity: .24, waveScale: 1.03, tempo: 1.3333333333, waveStart: 5, waveDuration: 13.6 };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < .00001, `${actual} differs from ${expected}`);

test('every row moves right at one constant speed and wraps at the actual artwork repeat', () => {
  const start = wordmarkMotion(geometry, 16000), later = wordmarkMotion(geometry, 18000);
  assert.equal(start.planeX, 0, 'no global drift cancels the row travel');
  for (let i = 0; i < geometry.rows; i += 1) {
    near(start.rows[i].x, 40);
    near(later.rows[i].x - start.rows[i].x, 5);
  }
  near(wordmarkMotion(geometry, geometry.period * 1000).rows[0].x, 0);
  near(wordmarkMotion(geometry, geometry.period * 1000 - 1).rows[0].x, geometry.width - .0025);
  // Different repeat widths must loop on their own edge, without a fixed 120px jump.
  const small = { ...geometry, width: 84, period: 33.6 };
  near(wordmarkMotion(small, small.period * 1000).rows[0].x, 0);
  near(wordmarkMotion(small, 16000).rows[0].x, 40);
});

test('wave starts only after its CSS delay and reaches brightness and growth peaks together', () => {
  const index = 20, delay = ((index - geometry.waveStart) * .32 - .9) * geometry.tempo * 1000;
  const cycle = geometry.waveDuration * geometry.tempo * 1000;
  const before = wordmarkMotion(geometry, delay - 1).rows[index];
  assert.equal(before.opacity, 0); assert.equal(before.scale, 1);
  const peak = wordmarkMotion(geometry, delay + cycle * .07).rows[index];
  near(peak.opacity, .24); near(peak.scale, 1.03);
  const half = wordmarkMotion(geometry, delay + cycle * .035).rows[index];
  near(half.opacity, .12); near(half.scale, 1.015);
  const end = wordmarkMotion(geometry, delay + cycle * .14).rows[index];
  near(end.opacity, 0); near(end.scale, 1);
});

test('reduced motion retains every row in the original static arrangement', () => {
  const frame = wordmarkMotion(geometry, 27300, true);
  assert.equal(frame.planeX, 0); assert.equal(frame.rows.length, 43);
  assert.ok(frame.rows.every(row => row.x === 0 && row.opacity === 0 && row.scale === 1));
});
