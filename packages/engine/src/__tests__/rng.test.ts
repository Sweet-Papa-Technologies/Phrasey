import { describe, expect, it } from 'vitest';
import { createRng, normalizeSeed } from '../rng.js';

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = Array.from({ length: 20 }, () => createRng(7).next());
    const b = createRng(7);
    expect(a[0]).toBe(createRng(7).next());
    expect(Array.from({ length: 20 }, () => b.next())[19]).not.toBeUndefined();
  });

  it('produces the same stream from the same seed', () => {
    const a = createRng(99);
    const b = createRng(99);
    for (let i = 0; i < 500; i++) expect(a.next()).toBe(b.next());
  });

  it('produces different streams for different seeds', () => {
    const a = Array.from({ length: 10 }, (_, i) => createRng(i).next());
    expect(new Set(a).size).toBe(10);
  });

  it('stays in [0, 1)', () => {
    const r = createRng(3);
    for (let i = 0; i < 2000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int() stays in range and degrades safely', () => {
    const r = createRng(11);
    for (let i = 0; i < 500; i++) {
      const v = r.int(6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
    expect(r.int(0)).toBe(0);
    expect(r.int(-4)).toBe(0);
    expect(r.int(Number.NaN)).toBe(0);
  });

  it('pick() selects from the array and throws when empty', () => {
    const r = createRng(5);
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 50; i++) expect(arr).toContain(r.pick(arr));
    expect(() => r.pick([])).toThrow(RangeError);
  });

  it('shuffle() permutes without mutating the input', () => {
    const r = createRng(21);
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = r.shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(out.slice().sort((a, b) => a - b)).toEqual(input);
    // Astronomically unlikely to be identity for 8 elements over 5 tries.
    const anyDifferent = [0, 1, 2, 3, 4].some(() => createRng(r.int(1e6)).shuffle(input).join() !== input.join());
    expect(anyDifferent).toBe(true);
    expect(r.shuffle([])).toEqual([]);
  });

  it('weighted() respects weights and skips non-positive ones', () => {
    const r = createRng(31);
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 4000; i++) {
      counts[r.weighted([['a', 90], ['b', 10], ['c', 0]] as const)]! += 1;
    }
    expect(counts.c).toBe(0);
    expect(counts.a).toBeGreaterThan(counts.b! * 3);
    expect(() => r.weighted([['x', 0]])).toThrow(RangeError);
    expect(() => r.weighted([])).toThrow(RangeError);
  });

  it('bool() honours the probability', () => {
    const r = createRng(41);
    let hits = 0;
    for (let i = 0; i < 2000; i++) if (r.bool(0.25)) hits++;
    expect(hits).toBeGreaterThan(350);
    expect(hits).toBeLessThan(650);
    expect(createRng(1).bool(0)).toBe(false);
    expect(createRng(1).bool(1)).toBe(true);
  });

  it('fork() gives an independent but reproducible child stream', () => {
    const a = createRng(77);
    const b = createRng(77);
    const childA = a.fork();
    const childB = b.fork();
    expect(childA.next()).toBe(childB.next());
    expect(a.next()).toBe(b.next());
    expect(createRng(77).fork().next()).not.toBe(createRng(77).next());
  });

  it('state() round-trips through a snapshot', () => {
    const r = createRng(1234);
    for (let i = 0; i < 17; i++) r.next();
    const snapshot = r.state();
    const expected = Array.from({ length: 10 }, () => r.next());
    const resumed = createRng(snapshot);
    expect(Array.from({ length: 10 }, () => resumed.next())).toEqual(expected);
  });

  it('normalizeSeed() coerces to uint32', () => {
    expect(normalizeSeed(-1)).toBe(0xffffffff);
    expect(normalizeSeed(Number.NaN)).toBe(0);
    expect(normalizeSeed(Infinity)).toBe(0);
    expect(normalizeSeed(42)).toBe(42);
  });
});
