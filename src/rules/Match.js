import {
  SET_POINTS_NORMAL,
  SET_POINTS_DECIDER,
  WIN_MARGIN,
  SETS_TO_WIN,
  SWITCH_EVERY_NORMAL,
  SWITCH_EVERY_DECIDER,
} from '../config.js';

const OTHER_TEAM = { A: 'B', B: 'A' };

// Tracks sets, points, serve, and which physical side (left/right) each team
// currently defends. Pure game-state; no rendering.
export default class Match {
  constructor() {
    this.setsWon = { A: 0, B: 0 };
    this.setScores = { A: 0, B: 0 };
    this.currentSet = 1;
    this.sideOfTeam = { A: 'left', B: 'right' };
    this.lastSwitchAt = 0;
    this.servingTeam = 'A';
    // Which of the team's two players serves next (0 or 1). Beach volleyball
    // rotation: a team swaps server each time it wins service back (side-out),
    // so a failed serve means the partner serves when the team regains it.
    this.serverIndex = { A: 0, B: 0 };
    this.matchOver = false;
    this.winnerTeam = null;
  }

  get setPointTarget() {
    return this.currentSet >= 3 ? SET_POINTS_DECIDER : SET_POINTS_NORMAL;
  }

  get switchInterval() {
    return this.currentSet >= 3 ? SWITCH_EVERY_DECIDER : SWITCH_EVERY_NORMAL;
  }

  teamAtSide(side) {
    return this.sideOfTeam.A === side ? 'A' : 'B';
  }

  otherTeam(team) {
    return OTHER_TEAM[team];
  }

  // Award a point to `team`. Returns a description of what happened so the
  // scene can drive banners/side swaps/animations off it.
  awardPoint(team) {
    this.setScores[team] += 1;

    // Side-out: the scoring team was NOT serving, so it wins service back and
    // rotates to its other player. Holding serve keeps the same server.
    if (this.servingTeam !== team) {
      this.serverIndex[team] = 1 - this.serverIndex[team];
    }
    this.servingTeam = team;

    const result = {
      team,
      setScores: { ...this.setScores },
      sideSwitch: false,
      setWon: false,
      matchOver: false,
    };

    const total = this.setScores.A + this.setScores.B;
    const interval = this.switchInterval;
    if (total > 0 && total % interval === 0 && total !== this.lastSwitchAt) {
      this.lastSwitchAt = total;
      this._swapSides();
      result.sideSwitch = true;
    }

    if (this._checkSetWon(team)) {
      result.setWon = true;
      this.setsWon[team] += 1;

      if (this.setsWon[team] >= SETS_TO_WIN) {
        this.matchOver = true;
        this.winnerTeam = team;
        result.matchOver = true;
      } else {
        this._startNextSet();
      }
    }

    return result;
  }

  _checkSetWon(team) {
    const score = this.setScores[team];
    const otherScore = this.setScores[this.otherTeam(team)];
    return score >= this.setPointTarget && score - otherScore >= WIN_MARGIN;
  }

  _swapSides() {
    this.sideOfTeam = { A: this.sideOfTeam.B, B: this.sideOfTeam.A };
  }

  _startNextSet() {
    this.currentSet += 1;
    this.setScores = { A: 0, B: 0 };
    this.lastSwitchAt = 0;
    // Teams alternate which side they start a new set on.
    this.sideOfTeam =
      this.currentSet % 2 === 1 ? { A: 'left', B: 'right' } : { A: 'right', B: 'left' };
  }

  reset() {
    this.setsWon = { A: 0, B: 0 };
    this.setScores = { A: 0, B: 0 };
    this.currentSet = 1;
    this.sideOfTeam = { A: 'left', B: 'right' };
    this.lastSwitchAt = 0;
    this.servingTeam = 'A';
    this.serverIndex = { A: 0, B: 0 };
    this.matchOver = false;
    this.winnerTeam = null;
  }
}
