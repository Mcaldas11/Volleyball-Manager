import Phaser from 'phaser';

// Each animation ships as a single horizontal strip PNG. Loading them as
// spritesheets (12 requests) instead of the pre-sliced individual frames
// (~180 requests) is a large load-time win. frameWidth = floor(stripWidth /
// count), which exactly reproduces how the frames were originally sliced.
const ANIMS = {
  playerIdle: { fw: 32, fh: 43, count: 12, rate: 10, repeat: -1 },
  playerRun: { fw: 32, fh: 43, count: 12, rate: 16, repeat: -1 },
  playerSlide: { fw: 40, fh: 43, count: 16, rate: 22, repeat: 0 },
  playerSmash: { fw: 29, fh: 50, count: 14, rate: 20, repeat: 0 },
  playerReception: { fw: 32, fh: 43, count: 11, rate: 20, repeat: 0 },
  playerBlock: { fw: 29, fh: 46, count: 14, rate: 18, repeat: 0 },
  ballFull: { fw: 16, fh: 20, count: 47, rate: 36, repeat: -1 },
  ballBounce: { fw: 15, fh: 20, count: 12, rate: 24, repeat: 0 },
  ballBounceHard: { fw: 15, fh: 20, count: 23, rate: 30, repeat: 0 },
  ballRoll: { fw: 15, fh: 20, count: 8, rate: 12, repeat: -1 },
  ballShot: { fw: 15, fh: 20, count: 10, rate: 30, repeat: -1 },
  pushbutton: { fw: 53, fh: 41, count: 5, rate: 6, repeat: -1 },
};

export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  preload() {
    // A tiny loading bar so a slow first load isn't a blank screen.
    const { width, height } = this.scale;
    const bar = this.add.rectangle(width / 2, height / 2, 0, 6, 0xffffff).setOrigin(0.5);
    const frame = this.add
      .rectangle(width / 2, height / 2, 200, 6)
      .setStrokeStyle(1, 0xffffff)
      .setOrigin(0.5);
    this.load.on('progress', (p) => bar.setSize(198 * p, 4));
    this.load.on('complete', () => {
      bar.destroy();
      frame.destroy();
    });

    for (const [key, a] of Object.entries(ANIMS)) {
      this.load.spritesheet(key, `/BVA2/${key}.png`, { frameWidth: a.fw, frameHeight: a.fh });
    }
    this.load.image('beachbkg', '/BVA2/beachbkgO.png');
    this.load.image('shadow', '/BVA2/shadow1.png');
    this.load.image('net', '/BVA2/net0/net0_1.png');
    this.load.image('bubbleOK', '/BVA2/bubbleOK.png');
  }

  create() {
    for (const [key, a] of Object.entries(ANIMS)) {
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers(key, { start: 0, end: a.count - 1 }),
        frameRate: a.rate,
        repeat: a.repeat,
      });
    }
    this.scene.start('Menu');
  }
}
