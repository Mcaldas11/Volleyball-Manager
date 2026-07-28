import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, DEFAULT_PLAYER } from '../config.js';
import Court from '../ui/Court.js';
import { makeButton } from '../ui/Button.js';

const COLORS = [
  { name: 'Azul', value: 0x4fc3f7 },
  { name: 'Verde', value: 0x81c784 },
  { name: 'Roxo', value: 0xba68c8 },
  { name: 'Laranja', value: 0xffb74d },
  { name: 'Rosa', value: 0xf06292 },
  { name: 'Branco', value: 0xffffff },
];

const NAMES = ['TU', 'MIGUEL', 'ACE', 'TUBARAO', 'SOL', 'PRAIA'];

export default class CustomizeScene extends Phaser.Scene {
  constructor() {
    super('Customize');
  }

  create() {
    new Court(this);
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x001018, 0.55).setOrigin(0, 0).setDepth(900);

    const saved = this.registry.get('player') || { ...DEFAULT_PLAYER };
    this.sel = { name: saved.name, color: saved.color };

    this.add
      .text(GAME_WIDTH / 2, 44, 'PERSONALIZAR', {
        fontFamily: 'monospace',
        fontSize: '30px',
        color: '#ffffff',
        stroke: '#003049',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(1000);

    // Live preview of the player sprite with the chosen colour.
    this.preview = this.add.sprite(GAME_WIDTH / 2, 190, 'playerIdle').setOrigin(0.5, 1).setDepth(1000).setScale(2.4);
    this.preview.play('playerIdle');
    this.preview.setTint(this.sel.color);

    this.nameLabel = this.add
      .text(GAME_WIDTH / 2, 205, '', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffe9a8',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5, 0)
      .setDepth(1000);

    // Colour swatches.
    this.add
      .text(GAME_WIDTH / 2, 244, 'COR', { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff' })
      .setOrigin(0.5)
      .setDepth(1000);

    const swW = 44;
    const gap = 12;
    const totalW = COLORS.length * swW + (COLORS.length - 1) * gap;
    let sx = GAME_WIDTH / 2 - totalW / 2 + swW / 2;
    this.swatches = [];
    for (const c of COLORS) {
      const r = this.add
        .rectangle(sx, 274, swW, 26, c.value, 1)
        .setStrokeStyle(2, 0xffffff, 0.6)
        .setDepth(1000)
        .setInteractive({ useHandCursor: true });
      r.on('pointerup', () => {
        this.sel.color = c.value;
        this._refresh();
      });
      this.swatches.push({ rect: r, value: c.value });
      sx += swW + gap;
    }

    // Name cycling.
    makeButton(this, GAME_WIDTH / 2 - 110, 322, '< NOME', () => this._cycleName(-1), { width: 150, fontSize: '14px' });
    makeButton(this, GAME_WIDTH / 2 + 110, 322, 'NOME >', () => this._cycleName(1), { width: 150, fontSize: '14px' });

    makeButton(this, GAME_WIDTH / 2, 380, 'GUARDAR E VOLTAR', () => {
      this.registry.set('player', { ...this.sel });
      this.scene.start('Menu');
    });

    this.input.keyboard.on('keydown-ESC', () => this.scene.start('Menu'));
    this._refresh();
  }

  _cycleName(dir) {
    const i = NAMES.indexOf(this.sel.name);
    const next = (i + dir + NAMES.length) % NAMES.length;
    this.sel.name = NAMES[next < 0 ? NAMES.length - 1 : next];
    this._refresh();
  }

  _refresh() {
    this.preview.setTint(this.sel.color);
    this.nameLabel.setText(this.sel.name);
    for (const s of this.swatches) {
      s.rect.setStrokeStyle(s.value === this.sel.color ? 4 : 2, s.value === this.sel.color ? 0xffe9a8 : 0xffffff, s.value === this.sel.color ? 1 : 0.6);
    }
  }
}
