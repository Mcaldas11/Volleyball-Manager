import Phaser from 'phaser';
import {
  NET_X,
  COURT_DEPTH,
  MID_DEPTH,
  HIT_REACH,
  AI,
} from '../config.js';

const dist2d = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// The AI "brain": decides where each computer-controlled player should move and
// when to jump/dive. It does NOT resolve ball contact - that stays centralised
// in GameScene so the touch/fault rules have a single source of truth.
//
// Positioning is driven by the ball's PREDICTED landing point (see
// Ball.predictLanding), so players run to where the ball is going instead of
// chasing where it currently is. Roles self-organise: whichever teammate is
// closest to the predicted landing takes it ("primary"); the other holds a
// net-side attacking spot ("support"). Recomputed every frame, this produces
// emergent dig -> set -> spike rallies.
export default class AIController {
  constructor(scene) {
    this.scene = scene;
    this.diveCooldown = new Map(); // playerId -> seconds remaining
  }

  update(dt) {
    const scene = this.scene;
    for (const id of this.diveCooldown.keys()) {
      this.diveCooldown.set(id, Math.max(0, this.diveCooldown.get(id) - dt));
    }

    if (scene.phase !== 'rally') {
      for (const p of scene.players) {
        if (!p.isHuman) p.moveTowards(...this._formationHome(p));
      }
      return;
    }

    const ball = scene.ball;
    const landing = ball.predictLanding();
    const landX = Phaser.Math.Clamp(landing.x, 8, scene.scale.width - 8);
    const landY = Phaser.Math.Clamp(landing.y, COURT_DEPTH.min, COURT_DEPTH.max);
    const ballSide = ball.x < NET_X ? 'left' : 'right';

    for (const team of ['A', 'B']) {
      const onOurSide = scene.match.sideOfTeam[team] === ballSide;
      const roster = scene.teams[team];
      const [primary, support] = this._rankByCloseness(roster, landX, landY);

      for (const player of roster) {
        if (player.isHuman) continue;

        if (onOurSide) {
          if (player === primary) {
            this._playIncoming(player, landX, landY, dt);
          } else {
            this._holdAttackSpot(player);
          }
        } else {
          this._defend(player);
        }
      }
    }
  }

  // --- Movement behaviours ---------------------------------------------------

  // Chase the predicted landing point and, when the ball is playable, jump or
  // dive to reach it. Contact is resolved by GameScene once we're close enough.
  _playIncoming(player, landX, landY, dt) {
    player.moveTowards(landX, landY);

    const ball = this.scene.ball;
    const flat = dist2d(ball.x, ball.y, player.x, player.y);
    const descending = ball.vz <= 0;

    // Jump to meet a high, reachable ball (dig/set/spike).
    if (player.grounded && descending && flat < HIT_REACH * AI.jumpReach && ball.z > 55 && ball.z < 175) {
      player.jump();
      return;
    }

    // Dive for a low ball that's just out of reach.
    const canDive = (this.diveCooldown.get(player.id) || 0) <= 0;
    if (player.grounded && canDive && descending && ball.z < 46 && flat > HIT_REACH && flat < HIT_REACH + 62) {
      const dx = ball.x - player.x;
      const dy = ball.y - player.y;
      player.x = Phaser.Math.Clamp(player.x + dx * 0.7, player.bounds.min, player.bounds.max);
      player.y = Phaser.Math.Clamp(player.y + dy * 0.7, COURT_DEPTH.min, COURT_DEPTH.max);
      player.triggerAction('playerSlide', 0.5);
      this.diveCooldown.set(player.id, 1.1);
    }
  }

  // The support player waits near the net at the ball's depth, ready to receive a
  // set and attack (or to be set to).
  _holdAttackSpot(player) {
    const ball = this.scene.ball;
    const netX = player.side === 'left' ? player.bounds.max - 24 : player.bounds.min + 24;
    const targetY = Phaser.Math.Clamp(ball.y, COURT_DEPTH.min + 16, COURT_DEPTH.max - 16);
    player.moveTowards(netX, targetY);
  }

  // Ball is on the opponent's side: front player shadows the net to block,
  // back player covers the deep court. Both track the ball's depth.
  _defend(player) {
    const ball = this.scene.ball;
    const b = player.bounds;
    const trackY = Phaser.Math.Clamp(ball.y, COURT_DEPTH.min + 12, COURT_DEPTH.max - 12);

    if (player.role === 'front') {
      const netX = player.side === 'left' ? b.max - 16 : b.min + 16;
      player.moveTowards(netX, trackY);

      // Time a block against a ball that's high and coming at our net.
      const nearNet = Math.abs(ball.x - NET_X) < 90;
      const incoming = player.side === 'left' ? ball.vx < 0 : ball.vx > 0;
      if (player.grounded && nearNet && incoming && ball.z > 80) {
        player.jump(true);
      }
    } else {
      const deepX = player.side === 'left' ? b.min + (b.max - b.min) * 0.35 : b.max - (b.max - b.min) * 0.35;
      player.moveTowards(deepX, trackY);
    }
  }

  // --- Helpers ---------------------------------------------------------------

  _rankByCloseness(roster, x, y) {
    const [a, b] = roster;
    return dist2d(a.x, a.y, x, y) <= dist2d(b.x, b.y, x, y) ? [a, b] : [b, a];
  }

  _formationHome(player) {
    const b = player.bounds;
    if (player.role === 'front') {
      return [player.side === 'left' ? b.max - 20 : b.min + 20, MID_DEPTH - 30];
    }
    const deepX = player.side === 'left' ? b.min + (b.max - b.min) * 0.35 : b.max - (b.max - b.min) * 0.35;
    return [deepX, MID_DEPTH + 30];
  }
}
