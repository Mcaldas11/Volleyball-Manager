import Phaser from 'phaser';
import {
  GAME_WIDTH,
  GAME_HEIGHT,
  SEA_Y,
  SAND_Y,
  NET_X,
  NET_PLAY_HEIGHT,
  COURT_OUTER,
  COURT_DEPTH,
} from '../config.js';

// Draws the whole backdrop procedurally so it fills any canvas size (no black
// bars on widescreen): sky gradient, sea, textured sand, the court markings and
// a mesh net. Static - drawn once at scene create.
export default class Court {
  constructor(scene) {
    this.scene = scene;
    this._drawBackground();
    this._drawCourt();
    this._drawNet();
  }

  _drawBackground() {
    const g = this.scene.add.graphics().setDepth(-1000);

    // Sky gradient.
    g.fillGradientStyle(0x38b6ff, 0x38b6ff, 0xbdecff, 0xbdecff, 1);
    g.fillRect(0, 0, GAME_WIDTH, SEA_Y);

    // Sun glow.
    g.fillStyle(0xffffff, 0.35);
    g.fillCircle(GAME_WIDTH * 0.2, SEA_Y * 0.5, 46);
    g.fillStyle(0xffffff, 0.5);
    g.fillCircle(GAME_WIDTH * 0.2, SEA_Y * 0.5, 30);

    // Sea band.
    g.fillGradientStyle(0x1f8fbf, 0x1f8fbf, 0x2bb7d6, 0x2bb7d6, 1);
    g.fillRect(0, SEA_Y, GAME_WIDTH, SAND_Y - SEA_Y);
    // Foam line.
    g.fillStyle(0xffffff, 0.6);
    g.fillRect(0, SAND_Y - 3, GAME_WIDTH, 3);

    // Sand.
    g.fillStyle(0xe6c48f, 1);
    g.fillRect(0, SAND_Y, GAME_WIDTH, GAME_HEIGHT - SAND_Y);
    g.fillGradientStyle(0xd8b070, 0xd8b070, 0xe7cd9a, 0xe7cd9a, 0.5);
    g.fillRect(0, SAND_Y, GAME_WIDTH, GAME_HEIGHT - SAND_Y);

    // Sand speckle texture.
    const rng = new Phaser.Math.RandomDataGenerator(['beach']);
    g.fillStyle(0xc9a266, 0.35);
    for (let i = 0; i < 260; i++) {
      const x = rng.between(0, GAME_WIDTH);
      const y = rng.between(SAND_Y, GAME_HEIGHT);
      g.fillCircle(x, y, rng.between(1, 2));
    }
  }

  _drawCourt() {
    const g = this.scene.add.graphics().setDepth(-900);
    const { min: xl, max: xr } = COURT_OUTER;
    const { min: yt, max: yb } = COURT_DEPTH;

    // Court sand slightly lighter inside the lines.
    g.fillStyle(0xefd6a6, 0.35);
    g.fillRect(xl, yt, xr - xl, yb - yt);

    // Boundary + centre line.
    g.lineStyle(3, 0xffffff, 0.9);
    g.strokeRect(xl, yt, xr - xl, yb - yt);
    g.lineBetween(NET_X, yt, NET_X, yb);
  }

  // The net spans the court's depth along the centre line. In this pseudo-3D
  // view that means a quad: at every depth y the net occupies the screen band
  // from (y - NET_PLAY_HEIGHT) up to y. Drawn as a filled polygon plus mesh
  // lines so it reads as a real net rather than a pole.
  _drawNet() {
    const x = NET_X;
    const yFar = COURT_DEPTH.min;
    const yNear = COURT_DEPTH.max;
    const topFar = yFar - NET_PLAY_HEIGHT;
    const topNear = yNear - NET_PLAY_HEIGHT;
    // Seen almost edge-on this net would be only a few px wide, which reads as a
    // pole. Widen it into a stylised band so it's legible as a net.
    const halfW = 9;

    // Behind the players (they sort by depth), but above the sand/court.
    const g = this.scene.add.graphics().setDepth(yFar - 1);

    // Net cloth.
    g.fillStyle(0xf5f5f5, 0.16);
    g.fillRect(x - halfW, topFar, halfW * 2, yNear - topFar);

    // Diagonal crosshatch mesh.
    g.lineStyle(1, 0xffffff, 0.32);
    const step = 9;
    for (let yy = topFar - halfW * 2; yy <= yNear + halfW * 2; yy += step) {
      g.lineBetween(x - halfW, yy, x + halfW, yy + halfW * 2);
      g.lineBetween(x - halfW, yy + halfW * 2, x + halfW, yy);
    }

    // Bright top tape running the full depth of the court.
    g.fillStyle(0xffffff, 0.97);
    g.fillRect(x - halfW - 1, topFar, halfW * 2 + 2, 4);
    g.fillRect(x - halfW - 1, topNear - 4, halfW * 2 + 2, 4);
    g.lineStyle(4, 0xffffff, 0.97);
    g.lineBetween(x - halfW - 1, topFar + 2, x - halfW - 1, topNear - 2);
    g.lineBetween(x + halfW + 1, topFar + 2, x + halfW + 1, topNear - 2);

    // Bottom edge where the net meets the sand.
    g.lineStyle(2, 0xffffff, 0.45);
    g.lineBetween(x - halfW, yFar, x - halfW, yNear);
    g.lineBetween(x + halfW, yFar, x + halfW, yNear);

    // Posts at each sideline.
    g.fillStyle(0x8a8a8a, 1);
    g.fillRect(x - 3, topFar, 6, NET_PLAY_HEIGHT);
    g.fillRect(x - 3, topNear, 6, NET_PLAY_HEIGHT);
    g.fillStyle(0x4a4a4a, 1);
    g.fillRect(x - 4, topFar - 4, 8, 5);
    g.fillRect(x - 4, topNear - 4, 8, 5);
  }
}
