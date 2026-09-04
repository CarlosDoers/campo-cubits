import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { QUBIT_COUNT, type SubItem, type Territory } from '../menu';
import type { Overlay } from '../ui/Overlay';
import { QubitField, type HitInfo } from './QubitField';
import { Ground } from './Ground';
import { Dust } from './Dust';
import { easeTo } from './helpers';

interface Pose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

/** Plano general: todo el campo a la vista. */
const OVERVIEW: Pose = { position: new THREE.Vector3(0, 11.5, 18.5), target: new THREE.Vector3(0, 0, 0.5) };
const FLIGHT_SECONDS = 1.6;

export class App {
  /** Se invoca al pulsar una subsección (pilar 3D o botón del panel). */
  onNavigate: (item: Territory, sub: SubItem) => void = () => {};

  private readonly renderer: THREE.WebGLRenderer;
  private readonly labelRenderer: CSS2DRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly composer: EffectComposer;
  private readonly timer = new THREE.Timer();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2(-2, -2);
  private readonly downPos = new THREE.Vector2();
  private pointerInside = false;
  private lastCount = -1;

  /** 0 = plano general, 1 = un territorio enfocado (el resto se atenúa). */
  private focus = 0;
  private flight: { from: Pose; to: Pose; t: number } | null = null;

  private readonly field: QubitField;
  private readonly ground = new Ground();
  private readonly dust = new Dust();

  constructor(
    private readonly container: HTMLElement,
    private readonly items: Territory[],
    private readonly overlay: Overlay,
  ) {
    const w = container.clientWidth;
    const h = container.clientHeight;

    // --- renderers ---
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(w, h);
    Object.assign(this.labelRenderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
    container.appendChild(this.labelRenderer.domElement);

    // --- escena / cámara ---
    this.scene.background = new THREE.Color(0x02040a);
    this.scene.fog = new THREE.FogExp2(0x04070f, 0.02);

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 200);
    this.camera.position.copy(OVERVIEW.position);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(OVERVIEW.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 34;
    this.controls.minPolarAngle = 0.35;
    this.controls.maxPolarAngle = 1.32;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.25;

    // --- objetos ---
    this.field = new QubitField(items, QUBIT_COUNT);
    this.scene.add(this.field.group, this.ground.group, this.dust.points);

    // --- postprocesado ---
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.85, 0.55, 0.2));
    this.composer.addPass(new OutputPass());

    this.bindEvents();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  select(id: string | null): void {
    this.field.select(id);
    const item = this.items.find((i) => i.id === id);
    if (item) {
      this.overlay.showItem(item);
      const p = this.field.hubPosition(item.id);
      if (p) this.flyTo(focusPose(p));
    } else {
      this.overlay.hide();
      this.flyTo(OVERVIEW);
    }
    this.controls.autoRotate = !item;
  }

  /** Vuelo suave de cámara hasta una pose; los controles se reactivan al llegar. */
  private flyTo(to: Pose): void {
    this.flight = {
      from: { position: this.camera.position.clone(), target: this.controls.target.clone() },
      to,
      t: 0,
    };
    this.controls.enabled = false;
  }

  // ---------- bucle ----------

  private tick(): void {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);
    this.focus = easeTo(this.focus, this.field.selected ? 1 : 0, dt, 4);

    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / FLIGHT_SECONDS);
      const s = f.t * f.t * (3 - 2 * f.t);
      this.camera.position.lerpVectors(f.from.position, f.to.position, s);
      this.controls.target.lerpVectors(f.from.target, f.to.target, s);
      this.camera.lookAt(this.controls.target);
      if (f.t >= 1) {
        this.flight = null;
        this.controls.enabled = true;
      }
    } else {
      this.controls.update();
    }

    this.field.update(dt, this.focus);
    this.ground.setFocus(this.focus);
    this.dust.update(dt, this.focus);

    const hit = this.pointerInside ? this.pick() : null;
    this.field.setHovered(hit);
    this.container.classList.toggle('is-hover', hit !== null && hit.kind !== 'qubit');

    if (this.field.booted !== this.lastCount) {
      this.lastCount = this.field.booted;
      this.overlay.setQubitCount(this.lastCount);
    }

    this.composer.render();
    this.labelRenderer.render(this.scene, this.camera);
  }

  private pick(): HitInfo | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    for (const hit of this.raycaster.intersectObjects(this.field.hitTargets(), false)) {
      const info = this.field.resolveHit(hit);
      if (info) return info;
    }
    return null;
  }

  // ---------- eventos ----------

  private bindEvents(): void {
    const el = this.renderer.domElement;

    el.addEventListener('pointermove', (e) => {
      this.pointerInside = true;
      this.updatePointer(e);
    });
    el.addEventListener('pointerleave', () => {
      this.pointerInside = false;
    });
    el.addEventListener('pointerdown', (e) => this.downPos.set(e.clientX, e.clientY));
    el.addEventListener('pointerup', (e) => {
      if (this.downPos.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > 6) return; // era un arrastre
      this.pointerInside = true;
      this.updatePointer(e);
      this.handleClick(this.pick());
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.select(null);
    });
    window.addEventListener('resize', () => this.resize());

    this.overlay.onClose = () => this.select(null);
    this.overlay.onSubClick = (item, sub) => this.onNavigate(item, sub);
  }

  private handleClick(hit: HitInfo | null): void {
    if (!hit || hit.kind === 'qubit') {
      if (this.field.selected) this.select(null);
      return;
    }
    if (hit.kind === 'item') {
      this.select(hit.itemId);
      return;
    }
    const item = this.items.find((i) => i.id === hit.itemId);
    const sub = item?.items.find((s) => s.id === hit.subId);
    if (item && sub) this.onNavigate(item, sub);
  }

  private updatePointer(e: PointerEvent): void {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
  }
}

/** Cámara elevada frente al territorio, con el cúbit desplazado a la izquierda para dejar sitio al panel. */
function focusPose(p: THREE.Vector3): Pose {
  return {
    position: new THREE.Vector3(p.x + 1.6, 7.2, p.z + 8.0),
    target: new THREE.Vector3(p.x + 1.6, 1.8, p.z - 0.8),
  };
}
