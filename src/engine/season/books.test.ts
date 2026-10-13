import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import { clubBooks, settlement } from './books.ts';

test('a season is settled once: what came and went match by match is not booked again', () => {
  const world = generateWorld({ seed: 5, startYear: 2026, scale: 'small', manager: stubManager() });
  const club = world.clubs.find((c) => c.tier === 1)!;
  const f = club.finances;
  const start = f.balance;
  const before = clubBooks(world, club);

  // The season's gate receipts and a cup's prize come in, the travel goes out, as the matches pay them.
  f.balance += 300_000 + 50_000 - 80_000;
  f.seasonIncome += 350_000;
  f.prizeMoney += 50_000;
  f.seasonExpenditure += 80_000;

  // The books count all of it, once.
  const books = clubBooks(world, club);
  assert.equal(books.totalIncome, before.totalIncome + 350_000);
  assert.equal(books.totalCosts, before.totalCosts + 80_000);
  assert.equal(books.income.find(([k]) => k === 'Gate receipts')![1], 300_000);
  assert.equal(books.income.find(([k]) => k === 'Prize money')![1], 50_000);

  // Over the season, the bank moves by exactly the season's result — not by the gate and prize twice.
  f.balance += settlement(books, f);
  assert.equal(f.balance - start, books.totalIncome - books.totalCosts);
});
