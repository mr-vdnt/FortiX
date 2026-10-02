import { test, expect } from 'vitest';
import { percentile } from '../../src/lib/math.js';

test('percentile - empty array returns 0', () => {
  expect(percentile([], 0.95)).toBe(0);
});

test('percentile - exact matches', () => {
  const arr = [10, 20, 30, 40, 50];
  expect(percentile(arr, 0)).toBe(10);
  expect(percentile(arr, 1)).toBe(50);
  expect(percentile(arr, 0.5)).toBe(30);
});

test('percentile - interpolation', () => {
  const arr = [10, 20];
  expect(percentile(arr, 0.5)).toBe(15);
  expect(percentile(arr, 0.25)).toBe(13);
});
