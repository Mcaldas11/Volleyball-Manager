/**
 * The manager as he will stand at the bench, in 3D — the same figure the match draws — turning
 * slowly on the spot, or turned by dragging, so the look can be seen from every side. And, asked
 * for one, a portrait of him: head and shoulders, for his profile.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, type JSX } from 'react';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  CanvasTexture, CircleGeometry, DirectionalLight, HemisphereLight, Mesh, MeshBasicMaterial, NeutralToneMapping,
  PerspectiveCamera, PMREMGenerator, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { Figure, type Look } from './figure3d.ts';
import { arms, buildRig, REF_HEIGHT, shape, STAND, STILL } from './playerRig.ts';

export interface CoachPreviewHandle {
  /** Head and shoulders, as a JPEG data URL — null without WebGL. */
  portrait(): string | null;
}

/** Standing easy, arms by his sides. */
const EASY = shape(STAND, { nod: 0.02, ...arms(0.06, 0.1, 0.2) });
const HEIGHT = 1.82;

/** A soft dark pool under his feet. */
function floorShadow(): Mesh {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return new Mesh(new CircleGeometry(0.55, 32), new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
}

export const CoachPreview = forwardRef<CoachPreviewHandle, { look: Look }>(function CoachPreview({ look }, ref): JSX.Element {
  const wrap = useRef<HTMLDivElement>(null);
  const view = useRef<{
    renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera; figure: Figure | null; yaw: number; size: [number, number];
  } | null>(null);

  // The stage, made once: lights, the hall's soft light all round, the camera on him.
  useEffect(() => {
    const box = wrap.current;
    if (box === null) return;
    // A canvas of its own each time: a WebGL context given back on cleanup can't be had again from the
    // same canvas — and React's development mode runs every effect twice.
    const el = document.createElement('canvas');
    el.className = 'coach-preview-canvas';
    box.prepend(el);
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas: el, antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch {
      el.remove();
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NeutralToneMapping;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const scene = new Scene();
    const pmrem = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    scene.environmentRotation.set(Math.PI / 2, 0, 0);
    scene.environmentIntensity = 0.5;
    room.dispose();
    pmrem.dispose();
    const sky = new HemisphereLight('#e8eeff', '#5a4a40', 0.9);
    sky.position.set(0, 0, 1);
    const key = new DirectionalLight('#ffffff', 2.1);
    key.position.set(2, 4, 5);
    const rim = new DirectionalLight('#cfe0ff', 1.3);
    rim.position.set(-3, -4, 3);
    scene.add(sky, key, rim, floorShadow());
    const camera = new PerspectiveCamera(24, 1, 0.1, 50);
    camera.up.set(0, 0, 1);
    view.current = { renderer, scene, camera, figure: null, yaw: 0.35, size: [1, 1] };

    const resize = (): void => {
      const w = Math.max(1, box.clientWidth);
      const h = Math.max(1, box.clientHeight);
      renderer.setSize(w, h, false);
      view.current!.size = [w, h];
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(box);

    // Turning on his own, unless being turned by hand.
    let dragging: number | null = null;
    const down = (e: PointerEvent): void => { dragging = e.clientX; el.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent): void => {
      if (dragging === null || view.current === null) return;
      view.current.yaw += (e.clientX - dragging) * 0.012;
      dragging = e.clientX;
    };
    const up = (): void => { dragging = null; };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);

    let raf = 0;
    let last = performance.now();
    const frame = (now: number): void => {
      const v = view.current;
      if (v === null) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (dragging === null) v.yaw += dt * 0.45;
      if (v.figure !== null) pose(v.figure, v.yaw);
      // Full length, a little below eye level.
      const [w, h] = v.size;
      camera.aspect = w / h;
      camera.fov = w / h < 0.62 ? 26 : 22;
      camera.position.set(0, 5.6, 1.05);
      camera.lookAt(0, 0, 0.94);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      view.current?.figure?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      el.remove();
      view.current = null;
    };
  }, []);

  // A new look: a new figure.
  useEffect(() => {
    const v = view.current;
    if (v === null) return;
    if (v.figure !== null) {
      v.scene.remove(v.figure.root);
      v.figure.dispose();
    }
    v.figure = new Figure(look);
    v.scene.add(v.figure.root);
    pose(v.figure, v.yaw);
  }, [JSON.stringify(look)]);

  useImperativeHandle(ref, () => ({
    portrait(): string | null {
      const v = view.current;
      if (v === null || v.figure === null) return null;
      const { renderer, scene, figure } = v;
      // Facing the lens, close on the head and shoulders.
      pose(figure, 0);
      figure.root.updateMatrixWorld(true);
      const head = figure.head.getWorldPosition(new Vector3());
      const shot = new PerspectiveCamera(17, 1, 0.1, 20);
      shot.up.set(0, 0, 1);
      shot.position.set(head.x, head.y + 1.25, head.z + 0.06);
      shot.lookAt(head.x, head.y, head.z - 0.02);
      const S = 256;
      const [w, h] = v.size;
      renderer.setSize(S, S, false);
      renderer.render(scene, shot);
      // Over the game's navy, as the other portraits sit on a backdrop.
      const out = document.createElement('canvas');
      out.width = S;
      out.height = S;
      const ctx = out.getContext('2d')!;
      const bg = ctx.createRadialGradient(S / 2, S * 0.38, 10, S / 2, S / 2, S * 0.72);
      bg.addColorStop(0, '#34507a');
      bg.addColorStop(1, '#111b2b');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, S, S);
      ctx.drawImage(renderer.domElement, 0, 0, S, S);
      renderer.setSize(w, h, false);
      pose(figure, v.yaw);
      return out.toDataURL('image/jpeg', 0.88);
    },
  }), []);

  return (
    <div className="coach-preview" ref={wrap}>
    </div>
  );
});

function pose(f: Figure, yaw: number): void {
  f.pose({ x: 0, y: 0, lift: 0, yaw, scale: HEIGHT / REF_HEIGHT, rig: buildRig(EASY, STILL), alpha: 1 });
}
