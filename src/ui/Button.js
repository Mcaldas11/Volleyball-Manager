// Shared menu button: rounded plate + label with hover/press feedback.
export function makeButton(scene, x, y, label, onClick, opts = {}) {
  const w = opts.width ?? 250;
  const h = opts.height ?? 42;
  const depth = opts.depth ?? 1000;

  const plate = scene.add
    .rectangle(x, y, w, h, 0x0b3d5c, 0.92)
    .setStrokeStyle(2, 0xffffff, 0.85)
    .setDepth(depth)
    .setInteractive({ useHandCursor: true });

  const text = scene.add
    .text(x, y, label, {
      fontFamily: 'monospace',
      fontSize: opts.fontSize ?? '18px',
      color: '#ffffff',
    })
    .setOrigin(0.5)
    .setDepth(depth + 1);

  plate.on('pointerover', () => {
    plate.setFillStyle(0x1667a0, 0.95);
    scene.tweens.add({ targets: [plate, text], scaleX: 1.04, scaleY: 1.04, duration: 90 });
  });
  plate.on('pointerout', () => {
    plate.setFillStyle(0x0b3d5c, 0.92);
    scene.tweens.add({ targets: [plate, text], scaleX: 1, scaleY: 1, duration: 90 });
  });
  plate.on('pointerdown', () => {
    scene.tweens.add({ targets: [plate, text], scaleX: 0.96, scaleY: 0.96, duration: 60, yoyo: true });
  });
  plate.on('pointerup', () => onClick?.());

  return { plate, text };
}
