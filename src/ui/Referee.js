import { GAME_WIDTH } from '../config.js';

// All the "visual referee" HUD elements: central rule banners, the bubbleOK
// validation flash, and the serve prompt. Pure presentation, driven by GameScene.
export default class Referee {
  constructor(scene) {
    this.scene = scene;

    this.banner = scene.add
      .text(GAME_WIDTH / 2, 60, '', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#fff200',
        stroke: '#000000',
        strokeThickness: 4,
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(2200)
      .setScale(0)
      .setAlpha(0);

    this.bubble = scene.add.image(0, 0, 'bubbleOK').setDepth(2100).setVisible(false).setScale(0);

    this.prompt = scene.add.sprite(0, 0, 'pushbutton').setDepth(2100).setVisible(false);
    this.prompt.play('pushbutton');

    this.promptLabel = scene.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
        align: 'center',
      })
      .setOrigin(0.5, 0)
      .setDepth(2100)
      .setVisible(false);
  }

  showBanner(text, duration = 1100) {
    this.scene.tweens.killTweensOf(this.banner);
    this.banner.setText(text).setScale(0).setAlpha(1);
    this.scene.tweens.add({
      targets: this.banner,
      scale: 1,
      duration: 160,
      ease: 'Back.Out',
      onComplete: () => {
        this.scene.time.delayedCall(duration, () => {
          this.scene.tweens.add({ targets: this.banner, alpha: 0, duration: 250 });
        });
      },
    });
  }

  flashBubble(x, y, duration = 450) {
    this.scene.tweens.killTweensOf(this.bubble);
    this.bubble.setPosition(x, y).setVisible(true).setScale(0).setAlpha(1);
    this.scene.tweens.add({
      targets: this.bubble,
      scale: 1,
      duration: 140,
      ease: 'Back.Out',
      onComplete: () => {
        this.scene.time.delayedCall(duration, () => {
          this.scene.tweens.add({
            targets: this.bubble,
            alpha: 0,
            duration: 200,
            onComplete: () => this.bubble.setVisible(false),
          });
        });
      },
    });
  }

  hideBanner() {
    this.scene.tweens.killTweensOf(this.banner);
    this.banner.setAlpha(0);
  }

  showServePrompt(x, y, label) {
    this.prompt.setPosition(x, y).setVisible(true);
    this.promptLabel.setPosition(x, y + 14).setText(label).setVisible(true);
  }

  hideServePrompt() {
    this.prompt.setVisible(false);
    this.promptLabel.setVisible(false);
  }
}
