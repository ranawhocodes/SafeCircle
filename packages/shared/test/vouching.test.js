import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateVouchOutcome } from '../dist/vouching.js';

test('F26: >=3 vouches with 0 concerns and >= 2/3 approval passes verification', () => {
  const openedAt = new Date('2026-01-01T10:00:00Z');
  const now = new Date('2026-01-03T10:00:00Z');

  const vouches = [
    { choice: 'vouch', createdAt: new Date('2026-01-01T11:00:00Z') },
    { choice: 'vouch', createdAt: new Date('2026-01-02T11:00:00Z') },
    { choice: 'vouch', createdAt: new Date('2026-01-03T09:00:00Z') },
  ];

  const result = evaluateVouchOutcome(vouches, openedAt, now);
  assert.equal(result.status, 'passed');
  assert.equal(result.vouchCount, 3);
  assert.equal(result.concernCount, 0);
});

test('F26: any concern vote flags the candidate for manual society admin review (referred)', () => {
  const openedAt = new Date('2026-01-01T10:00:00Z');
  const now = new Date('2026-01-03T10:00:00Z');

  const vouches = [
    { choice: 'vouch', createdAt: new Date('2026-01-01T11:00:00Z') },
    { choice: 'vouch', createdAt: new Date('2026-01-02T11:00:00Z') },
    { choice: 'vouch', createdAt: new Date('2026-01-02T12:00:00Z') },
    { choice: 'concern', createdAt: new Date('2026-01-03T09:00:00Z') },
  ];

  const result = evaluateVouchOutcome(vouches, openedAt, now);
  assert.equal(result.status, 'referred');
  assert.equal(result.concernCount, 1);
});

test('F26: less than 3 vouches within 7 days stays open', () => {
  const openedAt = new Date('2026-01-01T10:00:00Z');
  const now = new Date('2026-01-04T10:00:00Z'); // 3 days in

  const vouches = [
    { choice: 'vouch', createdAt: new Date('2026-01-02T11:00:00Z') },
    { choice: 'vouch', createdAt: new Date('2026-01-03T11:00:00Z') },
  ];

  const result = evaluateVouchOutcome(vouches, openedAt, now);
  assert.equal(result.status, 'open');
  assert.equal(result.vouchCount, 2);
});

test('F26: expiry after 7 days without 3 vouches marks round rejected', () => {
  const openedAt = new Date('2026-01-01T10:00:00Z');
  const now = new Date('2026-01-09T10:00:00Z'); // 8 days later

  const vouches = [
    { choice: 'vouch', createdAt: new Date('2026-01-02T11:00:00Z') },
    { choice: 'vouch', createdAt: new Date('2026-01-03T11:00:00Z') },
  ];

  const result = evaluateVouchOutcome(vouches, openedAt, now);
  assert.equal(result.status, 'rejected');
  assert.equal(result.vouchCount, 2);
});
