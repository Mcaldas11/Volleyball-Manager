import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config.js';
import Court from '../ui/Court.js';
import { makeButton } from '../ui/Button.js';

const LINES = [
  ['MOVER', 'WASD ou setas - andas por todo o teu meio-campo'],
  ['RECEBER', 'Clica com o rato quando a bola chega perto (sem saltar)'],
  ['SERVIR', 'Segura o rato para saltar e carregar, larga para bater'],
  ['ATACAR', 'Salta (segura o rato) junto a rede e larga no ponto alto'],
  ['BLOQUEAR', 'Botao DIREITO junto a rede salta para bloquear'],
  ['MIRA', 'A bola vai para onde o cursor estiver ao largares'],
  ['FORCA', 'Quanto mais tempo segurares, mais forte e rasteiro o ataque'],
  ['3 TOQUES', 'Passe -> levantamento -> ataque. Nao podes tocar 2x seguidas'],
];

export default class HowToScene extends Phaser.Scene {
  constructor() {
    super('HowTo');
  }

  create() {
    new Court(this);
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x001018, 0.62).setOrigin(0, 0).setDepth(900);

    this.add
      .text(GAME_WIDTH / 2, 38, 'COMO JOGAR', {
        fontFamily: 'monospace',
        fontSize: '30px',
        color: '#ffffff',
        stroke: '#003049',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(1000);

    let y = 88;
    for (const [key, desc] of LINES) {
      this.add
        .text(110, y, key, {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#ffe9a8',
          stroke: '#000000',
          strokeThickness: 3,
        })
        .setOrigin(0, 0.5)
        .setDepth(1000);
      this.add
        .text(240, y, desc, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 3,
        })
        .setOrigin(0, 0.5)
        .setDepth(1000);
      y += 30;
    }

    makeButton(this, GAME_WIDTH / 2, GAME_HEIGHT - 46, 'VOLTAR', () => this.scene.start('Menu'));
    this.input.keyboard.on('keydown-ESC', () => this.scene.start('Menu'));
  }
}
