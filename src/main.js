import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './config.js';
import PreloadScene from './scenes/PreloadScene.js';
import MenuScene from './scenes/MenuScene.js';
import CustomizeScene from './scenes/CustomizeScene.js';
import HowToScene from './scenes/HowToScene.js';
import GameScene from './scenes/GameScene.js';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-container',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#0d1b24',
  render: { pixelArt: true, antialias: false, roundPixels: true },
  scale: {
    // The world is 16:9, so FIT fills a widescreen monitor edge to edge with no
    // letterboxing, in both windowed and fullscreen.
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    fullscreenTarget: 'game-container',
    expandParent: true,
  },
  scene: [PreloadScene, MenuScene, CustomizeScene, HowToScene, GameScene],
});
