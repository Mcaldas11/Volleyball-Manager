/**
 * Volleyball Manager Dev desktop event contract v2.
 * A dependency-free, optional bridge from audited original V16.6 game hooks.
 * Event listeners never get to break original gameplay, audio, or saved games.
 */
(() => {
  'use strict';
  if (window.__vmEvents) return;
  const TYPES = new Set([
    'match:start', 'match:point', 'match:review:start',
    'match:review:result', 'match:review:end', 'match:contact',
    'match:pause', 'match:resume', 'match:set-break'
  ]);
  const listeners = new Map();
  const seenPoints = new Set();
  const stats = { emitted: 0, rejected: 0, errors: 0, contacts: 0, contactsHandled: 0 };

  function normalize(name, data) {
    if (!TYPES.has(name) || !data || typeof data !== 'object') return null;
    if (name === 'match:set-break') return Object.freeze({});
    // One notification per real animation contact. No rate-limit or dedup:
    // two touches may legitimately occur only milliseconds apart.
    if (name === 'match:contact') {
      if (typeof data.hard !== 'boolean' ||
          (data.pose != null && typeof data.pose !== 'string')) return null;
      return Object.freeze({
        hard: data.hard,
        pose: typeof data.pose === 'string' ? data.pose.slice(0, 32) : ''
      });
    }
    if (name === 'match:pause' || name === 'match:resume') {
      if (data.manual !== true) return null;
      return Object.freeze({ manual: true });
    }
    if (name === 'match:start') {
      if (typeof data.userIsHome !== 'boolean') return null;
      return Object.freeze({ userIsHome: data.userIsHome });
    }
    if (name === 'match:point') {
      const score = data.scoreBefore;
      if (!Array.isArray(score) || score.length !== 2 ||
          !score.every(x => Number.isInteger(x) && x >= 0) ||
          ![0, 1].includes(data.winner) || !Number.isInteger(data.set) ||
          data.set < 1 || typeof data.userIsHome !== 'boolean') return null;
      return Object.freeze({
        set: data.set, scoreBefore: Object.freeze([...score]),
        setTarget: [15, 25].includes(data.setTarget) ? data.setTarget : undefined,
        setFinished: typeof data.setFinished === 'boolean' ? data.setFinished : undefined,
        winner: data.winner, userIsHome: data.userIsHome,
        contacts: Number.isInteger(data.contacts) ? Math.max(0, data.contacts) : 0,
        lastKind: typeof data.lastKind === 'string' ? data.lastKind : '',
        closeCall: data.closeCall === true
      });
    }
    if (name === 'match:review:end') {
      return Object.freeze({ seq: data.seq ?? null });
    }
    if (name === 'match:review:start') {
      if (![0, 1].includes(data.team) || typeof data.userIsHome !== 'boolean') return null;
      return Object.freeze({
        seq: data.seq ?? null, team: data.team, userIsHome: data.userIsHome
      });
    }
    if (name === 'match:review:result') {
      if (![0, 1].includes(data.team) || typeof data.userIsHome !== 'boolean' ||
          typeof data.overturned !== 'boolean') return null;
      return Object.freeze({
        seq: data.seq ?? null, team: data.team, userIsHome: data.userIsHome,
        overturned: data.overturned
      });
    }
    return null;
  }
  function on(name, callback) {
    if (!TYPES.has(name) || typeof callback !== 'function') return () => {};
    let slot = listeners.get(name);
    if (!slot) { slot = new Set(); listeners.set(name, slot); }
    slot.add(callback);
    return () => {
      slot.delete(callback);
      if (!slot.size) listeners.delete(name);
    };
  }
  function emit(name, input) {
    const detail = normalize(name, input);
    if (!detail) { stats.rejected++; return false; }
    if (name === 'match:start') seenPoints.clear();
    if (name === 'match:point') {
      const key = [detail.set, ...detail.scoreBefore, detail.winner].join(':');
      if (seenPoints.has(key)) return false; // never trigger subscribers twice for one rally
      seenPoints.add(key);
      if (seenPoints.size > 400) seenPoints.clear(); // bounded memory for long matches
    }
    stats.emitted++;
    if (name === 'match:contact') stats.contacts++;
    let handled = false;
    for (const listener of [...(listeners.get(name) || [])]) {
      try {
        // Only a real audio handler returning true may consume a contact.
        // A monitoring listener must NEVER silence the game's original hit.
        if (listener(detail) === true && name === 'match:contact') handled = true;
      } catch (err) {
        stats.errors++; console.warn('VM event listener failed:', name, err);
      }
    }
    if (name === 'match:contact') {
      if (handled) stats.contactsHandled++;
      return handled;
    }
    return true;
  }
  window.__vmEvents = Object.freeze({
    version: 2, on, emit,
    getStats: () => Object.freeze({ ...stats, subscriptions:
      [...listeners.values()].reduce((n, x) => n + x.size, 0) })
  });
})();
