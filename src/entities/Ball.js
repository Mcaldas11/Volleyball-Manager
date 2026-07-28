import Phaser from 'phaser';
import { GRAVITY, NET_X, NET_PLAY_HEIGHT, GAME_WIDTH, MID_DEPTH, COURT_DEPTH } from '../config.js';

export default class Ball {
  constructor(scene) {
    this.scene = scene;

    this.shadow = scene.add.ellipse(0, 0, 14, 6, 0x000000, 0.35);

    this.sprite = scene.add.sprite(0, 0, 'ballFull');
    this.sprite.setOrigin(0.5, 0.5);
    this.sprite.play('ballFull');

    this.x = GAME_WIDTH / 2;
    this.y = MID_DEPTH;
    this.z = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.lastHitSide = null;
    this.lastHitTeam = null;
    this._prevX = this.x;

    this._sync();
  }

  reset(x, y, z = 70) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.lastHitSide = null;
    this.lastHitTeam = null;
    this._prevX = x;
    this.sprite.play('ballFull');
    this._sync();
  }

  // Launch towards (targetX, targetY) arcing up to roughly `apex`. Flight time is
  // derived from the apex so the ball actually lands on the target rather than
  // overshooting it.
  launchTo(targetX, targetY, apex = 90) {
    const z0 = this.z;
    const rise = Math.max(apex - z0, 12);
    this.vz = Math.sqrt(2 * GRAVITY * rise);
    const duration = (this.vz + Math.sqrt(this.vz * this.vz + 2 * GRAVITY * z0)) / GRAVITY;
    this.vx = (targetX - this.x) / duration;
    this.vy = (targetY - this.y) / duration;

    const speed = Math.hypot(this.vx, this.vy, this.vz);
    this.sprite.play(speed > 420 ? 'ballShot' : 'ballFull');
    // Spin faster when hit harder.
    this.sprite.anims.timeScale = Phaser.Math.Clamp(speed / 320, 0.7, 2.4);
  }

  // Returns { landed, netFault, crossed } for the scene to react to.
  update(dt) {
    this.vz -= GRAVITY * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;

    let netFault = null;
    let crossed = null;

    const wasLeft = this._prevX < NET_X;
    const isLeft = this.x < NET_X;
    if (wasLeft !== isLeft) {
      if (this.z < NET_PLAY_HEIGHT) {
        netFault = wasLeft ? 'left' : 'right';
        this.x = NET_X + (isLeft ? -1 : 1) * 3;
        this.vx *= -0.4;
        this.vz *= 0.4;
      } else {
        crossed = isLeft ? 'left' : 'right';
      }
    }
    this._prevX = this.x;

    let landed = null;
    if (this.z <= 0) {
      this.z = 0;
      landed = this.x < NET_X ? 'left' : 'right';
    }

    this._sync();
    return { landed, netFault, crossed };
  }

  playImpact() {
    const speed = Math.hypot(this.vx, this.vy, this.vz);
    this.sprite.anims.timeScale = 1;
    this.sprite.play(speed > 320 ? 'ballBounceHard' : 'ballBounce');
  }

  playRoll() {
    this.sprite.play('ballRoll');
  }

  // Where and when the ball next hits the sand - the AI runs to this point.
  predictLanding() {
    const disc = this.vz * this.vz + 2 * GRAVITY * this.z;
    const t = (this.vz + Math.sqrt(Math.max(0, disc))) / GRAVITY;
    return { x: this.x + this.vx * t, y: this.y + this.vy * t, t };
  }

  _sync() {
    this.sprite.x = this.x;
    this.sprite.y = this.y - this.z;
    this.sprite.setDepth(this.y + 2);

    const k = Math.max(0.35, 1 - this.z / 300);
    this.shadow.x = this.x;
    this.shadow.y = Phaser.Math.Clamp(this.y, COURT_DEPTH.min, COURT_DEPTH.max);
    this.shadow.setDepth(this.y - 2);
    this.shadow.setScale(k, k);
    this.shadow.setAlpha(0.35 * k);
  }
}
