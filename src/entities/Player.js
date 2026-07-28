import Phaser from 'phaser';
import { GRAVITY, PLAYER_SPEED, PLAYER_JUMP_SPEED, COURT_DEPTH } from '../config.js';

// Approx distance from feet to hands, used to decide if a player can reach the ball.
const BODY_REACH_HEIGHT = 42;

let nextId = 1;

export default class Player {
  constructor(scene, { x, y, side, team, isHuman, bounds, tint }) {
    this.scene = scene;
    this.id = nextId++;
    this.team = team; // 'A' | 'B' - fixed for the whole match
    this.side = side; // 'left' | 'right' - current physical side (swaps on side-switch)
    this.isHuman = isHuman;
    this.bounds = bounds; // { min, max } - x range for this player's half

    this.x = x;
    this.y = y; // depth position along the net
    this.homeX = x;
    this.homeY = y;
    this.z = 0;
    this.vz = 0;
    this.vx = 0;
    this.vy = 0;
    this.facing = side === 'left' ? 1 : -1;

    // Elliptical drop shadow drawn per-frame (replaces the tiny shadow sprite,
    // which didn't scale well and had hard edges).
    this.shadow = scene.add.ellipse(x, y, 22, 8, 0x000000, 0.32);

    this.sprite = scene.add.sprite(x, y, 'playerIdle');
    this.sprite.setOrigin(0.5, 1);
    this.sprite.setFlipX(side === 'right');
    if (tint) this.sprite.setTint(tint);

    this.currentAnim = null;
    this._playAnim('playerIdle');

    this.actionTimer = 0; // while > 0 a one-shot anim (slide/block/reception) owns the sprite
    this.blocking = false; // true while airborne with a block attempt
  }

  get handHeight() {
    return this.z + BODY_REACH_HEIGHT;
  }

  get grounded() {
    return this.z <= 0 && this.vz === 0;
  }

  _playAnim(key) {
    if (this.currentAnim === key) return;
    this.currentAnim = key;
    this.sprite.play(key);
  }

  triggerAction(key, duration) {
    this.currentAnim = key;
    this.sprite.play(key);
    this.actionTimer = duration;
  }

  jump(blocking = false) {
    if (!this.grounded) return false;
    this.vz = PLAYER_JUMP_SPEED;
    this.blocking = blocking;
    this.triggerAction(blocking ? 'playerBlock' : 'playerSmash', 0.55);
    return true;
  }

  moveTowards(targetX, targetY) {
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 3) {
      this.vx = 0;
      this.vy = 0;
    } else {
      this.vx = (dx / dist) * PLAYER_SPEED;
      this.vy = (dy / dist) * PLAYER_SPEED;
    }
  }

  setInputVelocity(vx, vy) {
    this.vx = vx;
    this.vy = vy;
  }

  placeAt(x, y) {
    this.x = Phaser.Math.Clamp(x, this.bounds.min, this.bounds.max);
    this.y = Phaser.Math.Clamp(y, COURT_DEPTH.min, COURT_DEPTH.max);
    this.vx = 0;
    this.vy = 0;
    this.z = 0;
    this.vz = 0;
    this.blocking = false;
    this.sprite.x = this.x;
    this.sprite.y = this.y;
  }

  setSide(side, bounds) {
    this.side = side;
    this.bounds = bounds;
    this.x = Phaser.Math.Clamp(this.x, bounds.min, bounds.max);
    this.homeX = Phaser.Math.Clamp(this.homeX, bounds.min, bounds.max);
    this.facing = side === 'left' ? 1 : -1;
    this.sprite.setFlipX(side === 'right');
    this.sprite.x = this.x;
  }

  setTint(color) {
    this.sprite.setTint(color);
  }

  update(dt) {
    // Free 2D movement inside this player's half; bounds act as hard walls so a
    // player can never cross the net.
    this.x = Phaser.Math.Clamp(this.x + this.vx * dt, this.bounds.min, this.bounds.max);
    this.y = Phaser.Math.Clamp(this.y + this.vy * dt, COURT_DEPTH.min, COURT_DEPTH.max);
    if (this.vx !== 0) {
      this.facing = Math.sign(this.vx);
      this.sprite.setFlipX(this.facing < 0);
    }

    // Jump arc.
    if (this.z > 0 || this.vz !== 0) {
      this.vz -= GRAVITY * dt;
      this.z += this.vz * dt;
      if (this.z <= 0) {
        this.z = 0;
        this.vz = 0;
        this.blocking = false;
      }
    }

    // One-shot actions hold the sprite; otherwise idle/run/air state.
    if (this.actionTimer > 0) {
      this.actionTimer -= dt;
    } else if (!this.grounded) {
      this._playAnim(this.blocking ? 'playerBlock' : 'playerSmash');
    } else if (Math.abs(this.vx) > 1 || Math.abs(this.vy) > 1) {
      this._playAnim('playerRun');
    } else {
      this._playAnim('playerIdle');
    }

    this.sprite.x = this.x;
    this.sprite.y = this.y - this.z;
    this.sprite.setDepth(this.y);

    // Shadow stays on the sand and shrinks/fades with jump height.
    const k = Math.max(0.45, 1 - this.z / 240);
    this.shadow.x = this.x;
    this.shadow.y = this.y;
    this.shadow.setDepth(this.y - 3);
    this.shadow.setScale(k, k);
    this.shadow.setAlpha(0.32 * k);
  }
}
