import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, DEFAULT_PLAYER } from '../config.js';
import Court from '../ui/Court.js';
import { makeButton } from '../ui/Button.js';

export default class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create() {
    new Court(this);

    // Dim the court so the menu reads clearly on top of it.
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x001018, 0.45).setOrigin(0, 0).setDepth(900);

    if (!this.registry.has('player')) this.registry.set('player', { ...DEFAULT_PLAYER });

    this.add
      .text(GAME_WIDTH / 2, 74, 'BEACH VOLLEY 2v2', {
        fontFamily: 'monospace',
        fontSize: '40px',
        color: '#ffffff',
        stroke: '#003049',
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setDepth(1000);

    this.add
      .text(GAME_WIDTH / 2, 112, 'praia • sol • 3 toques', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#ffe9a8',
      })
      .setOrigin(0.5)
      .setDepth(1000);

    const cx = GAME_WIDTH / 2;
    makeButton(this, cx, 190, 'JOGAR', () => this.scene.start('Game'));
    makeButton(this, cx, 245, 'PERSONALIZAR', () => this.scene.start('Customize'));
    makeButton(this, cx, 300, 'COMO JOGAR', () => this.scene.start('HowTo'));

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 16, 'F = ecra inteiro', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setDepth(1000)
      .setAlpha(0.7);

    this.input.keyboard.on('keydown-F', () => {
      if (this.scale.isFullscreen) this.scale.stopFullscreen();
      else this.scale.startFullscreen();
    });
  }
}
