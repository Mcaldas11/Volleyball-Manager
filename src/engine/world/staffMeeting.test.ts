import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { DAYS_PER_SEASON, seasonEndDay, stubManager } from './world.ts';
import { appointManager } from './career.ts';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { PlayerFlag } from '../model/players.ts';
import { Position } from '../model/positions.ts';
import { messageNeedsAction, MONTH_STARTS } from './inbox.ts';
import { loadOf } from './training.ts';
import {
  acceptSuggestion, declineSuggestion, isMeetingDay, meetingSuggestions, medicalRestUntil, meetingsOf, openItems,
} from './staffMeeting.ts';

function career() {
  const world = generateWorld({ seed: 64, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const club = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12)[2];
  appointManager(world, club.id);
  return { world, ctx, club };
}

test('on the third of each month the staff meet, and the meeting comes to the inbox wanting answers', () => {
  const { world, ctx } = career();
  for (let d = 0; d < 80 && meetingsOf(world).length === 0; d++) advanceDay(world, ctx, {});
  const meeting = meetingsOf(world)[0];
  assert.ok(meeting !== undefined, 'a meeting');
  assert.ok(MONTH_STARTS.some((m) => m + 2 === meeting.day % DAYS_PER_SEASON), 'on the third of a month');
  assert.ok(meeting.items.length >= 1 && meeting.items.length <= 6);
  const m = world.messages.find((x) => x.meetingId === meeting.id)!;
  assert.ok(m !== undefined && messageNeedsAction(world, m));
  // Answer everything: nothing left wanting action.
  for (const it of meeting.items) declineSuggestion(world, meeting.id, it.id);
  assert.equal(openItems(meeting).length, 0);
  assert.ok(!messageNeedsAction(world, m));
  // Declined, not brought up again at once.
  const again = meetingSuggestions(world);
  for (const it of meeting.items) assert.ok(!again.some((s) => s.kind === it.kind && s.p === it.p && s.position === it.position));
});

test('the suggestions are concrete: a key contract, a short position, an injury risk — and taking them does the thing', () => {
  const { world, club } = career();
  const store = world.players;
  const seniors = club.players.filter((p) => !store.hasFlag(p, PlayerFlag.Youth));
  const best = [...seniors].sort((a, b) => store.currentAbility[b] - store.currentAbility[a])[0];
  store.contractUntil[best] = seasonEndDay(world.season);
  for (const p of seniors) if (store.position[p] === Position.Libero) store.contractUntil[p] = seasonEndDay(world.season);
  const tired = seniors.find((p) => p !== best && store.position[p] !== Position.Libero)!;
  store.condition[tired] = 55;
  store.birthYear[tired] = world.year - 33;

  world.day = world.season * DAYS_PER_SEASON + 2 + 31;
  assert.ok(isMeetingDay(world));
  const kinds = meetingSuggestions(world);
  const renew = kinds.find((s) => s.kind === 'renew' && s.p === best);
  const short = kinds.find((s) => s.kind === 'position' && s.position === Position.Libero);
  const risk = kinds.find((s) => s.kind === 'injury' && s.p === tired);
  assert.ok(renew !== undefined, 'the best player\'s contract');
  assert.ok(short !== undefined, 'no liberos next season');
  assert.ok(risk !== undefined, 'a worn-down veteran');
  assert.equal(kinds[0].kind, 'injury', 'the most pressing first');

  world.staffMeetings = [{ id: 1, day: world.day, items: kinds.map((s, i) => ({ ...s, id: i, status: 'open' as const })) }];
  const id = (k: string) => world.staffMeetings![0].items.find((i) => i.kind === k)!.id;
  // The doctor's word: a lighter fortnight, which the training load follows.
  acceptSuggestion(world, 1, id('injury'));
  assert.ok(medicalRestUntil(world, tired) !== undefined);
  assert.ok(loadOf(world, club, tired) !== 'normal' && loadOf(world, club, tired) !== 'extra');
  // The scouts: names on the plan for the gap, and gone to watch them.
  const pos = acceptSuggestion(world, 1, id('position'))!;
  const targets = world.squadPlan?.targets ?? [];
  assert.ok(targets.length > 0 && targets.every((t) => t.position === Position.Libero), pos.outcome);
  assert.ok(targets.every((t) => world.scoutingQueue.some((q) => q.playerIdx === t.p)));
  // The renewal is left for the talks to open.
  assert.equal(acceptSuggestion(world, 1, id('renew'))!.status, 'accepted');
  // Taken once: a second time does nothing.
  assert.equal(acceptSuggestion(world, 1, id('renew')), undefined);
});

test('the next meeting lapses whatever was left open', () => {
  const { world, ctx } = career();
  for (let d = 0; d < 120 && meetingsOf(world).length < 2; d++) advanceDay(world, ctx, {});
  const [first, second] = meetingsOf(world);
  assert.ok(second !== undefined, 'two meetings');
  assert.ok(first.items.every((i) => i.status === 'lapsed'));
  assert.ok(second.items.some((i) => i.status === 'open'));
});
