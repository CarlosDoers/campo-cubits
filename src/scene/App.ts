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
import { PALETTE } from '../palette';
import { easeTo } from './helpers';

interface Pose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

/** Inclinacion del plano general: cuanto se mira el chip desde arriba. */
const OVERVIEW_PITCH = 0.8;
/** Lo que el sustrato sobresale de la retícula, en media diagonal (ver `Ground`). */
const DIE_OVERHANG = 1.9;
/**
 * Inclinación al enfocar un territorio: mucho más rasante que el plano general, para
 * que el chip se vea casi de canto y las subsecciones se lean flotando **sobre** él.
 * Debe quedar por debajo de `maxPolarAngle`, o los controles la recortarían al soltar.
 */
const FOCUS_PITCH = 0.3;
const UP = new THREE.Vector3(0, 1, 0);
const FLIGHT_SECONDS = 1.6;
/** Retirada de cámara de la entrada: acompaña al encendido del chip. */
const INTRO_SECONDS = 3.4;
const INTRO_PITCH = 0.2; // arranca casi a ras del sustrato
const INTRO_AZIMUTH = 0.75;
const INTRO_ZOOM = 0.5; // y a la mitad de distancia que el plano general

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
  private flight: { from: Pose; to: Pose; t: number; seconds: number } | null = null;
  /** Plano general, recalculado con el tamano del chip y la forma del encuadre. */
  private overview: Pose = { position: new THREE.Vector3(), target: new THREE.Vector3() };
  private lastStatus = '';

  private readonly field: QubitField;
  private readonly ground: Ground;

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
    // Fondo plano y sin niebla: fuera las motas de polvo, la rejilla y el espejo.
    this.scene.background = new THREE.Color(PALETTE.bg);

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 200);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
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
    this.ground = new Ground(this.field.topology.width, this.field.topology.depth);
    this.scene.add(this.field.group, this.ground.group);

    this.fitOverview();
    this.controls.target.copy(this.overview.target);
    // Entrada: la cámara empieza cerca y casi a ras, y se retira al plano general
    // mientras el frente de encendido cruza el chip.
    const d = this.overview.position.distanceTo(this.overview.target) * INTRO_ZOOM;
    this.camera.position.set(
      this.overview.target.x + Math.sin(INTRO_AZIMUTH) * d * Math.cos(INTRO_PITCH),
      this.overview.target.y + d * Math.sin(INTRO_PITCH),
      this.overview.target.z + Math.cos(INTRO_AZIMUTH) * d * Math.cos(INTRO_PITCH),
    );
    this.flyTo(this.overview, INTRO_SECONDS);

    // --- postprocesado ---
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.32, 0.8, 0.62));
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
      if (p) this.flyTo(this.focusPose(p));
    } else {
      this.overlay.hide();
      this.flyTo(this.overview);
    }
    this.controls.autoRotate = !item;
  }

  /** Vuelo suave de cámara hasta una pose; los controles se reactivan al llegar. */
  private flyTo(to: Pose, seconds = FLIGHT_SECONDS): void {
    this.flight = {
      from: { position: this.camera.position.clone(), target: this.controls.target.clone() },
      to,
      t: 0,
      seconds,
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
      f.t = Math.min(1, f.t + dt / f.seconds);
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

    // Azimut de la cámara: orienta el reparto de las subsecciones hacia el espectador.
    const camAz = Math.atan2(
      this.camera.position.x - this.controls.target.x,
      this.camera.position.z - this.controls.target.z,
    );
    this.field.update(dt, this.focus, camAz);
    this.ground.update(dt);
    this.ground.setFocus(this.focus);

    const hit = this.pointerInside ? this.pick() : null;
    this.field.setHovered(hit);
    this.container.classList.toggle('is-hover', hit !== null && hit.kind !== 'qubit');

    if (this.field.booted !== this.lastCount) {
      this.lastCount = this.field.booted;
      this.overlay.setQubitCount(this.lastCount);
    }

    const status = this.field.booting ? 'Encendiendo el procesador' : this.field.circuit.status;
    if (status !== this.lastStatus) {
      this.lastStatus = status;
      this.overlay.setCircuit(status);
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
    this.fitOverview();
    if (!this.flight && !this.field.selected) {
      this.camera.position.copy(this.overview.position);
      this.controls.target.copy(this.overview.target);
    }
  }

  /**
   * Coloca el plano general para que el chip entero quepa en el encuadre, por el lado
   * mas estrecho. Sin esto el campo se sale por abajo y por los lados y deja de leerse
   * como una pieza.
   */
  private fitOverview(): void {
    const { width, depth } = this.field.topology;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    // El chip gira despacio, así que el caso peor no es su lado mayor sino su diagonal,
    // más lo que el sustrato sobresale de la retícula.
    const half = Math.hypot(width, depth) / 2 + DIE_OVERHANG;
    // Y hay que contar con la perspectiva: el borde cercano está `half·cos(pitch)` más
    // cerca de la cámara que el centro, así que se proyecta bastante más grande. Con la
    // fórmula ortográfica de antes el chip se salía por la esquina de abajo.
    const near = half * Math.cos(OVERVIEW_PITCH);
    const dist =
      Math.max((half * Math.sin(OVERVIEW_PITCH)) / Math.tan(vFov / 2), half / Math.tan(hFov / 2)) + near;
    this.overview.target.set(0, 0.4, 0);
    this.overview.position.set(0, dist * Math.sin(OVERVIEW_PITCH), dist * Math.cos(OVERVIEW_PITCH));
  }

  /**
   * Enfoque de un territorio: la camara baja y se acerca, pero **sin dejar de ver el
   * chip**. El toten queda a la izquierda para dejarle sitio al panel.
   */
  private focusPose(p: THREE.Vector3): Pose {
    // Se conserva el azimut actual —la transicion se lee como un empujon de camara, no
    // como un salto a otro sitio— pero la camara baja hasta `FOCUS_PITCH`.
    const az = Math.atan2(
      this.camera.position.x - this.controls.target.x,
      this.camera.position.z - this.controls.target.z,
    );
    const dir = new THREE.Vector3(
      Math.sin(az) * Math.cos(FOCUS_PITCH),
      Math.sin(FOCUS_PITCH),
      Math.cos(az) * Math.cos(FOCUS_PITCH),
    );
    const right = new THREE.Vector3().crossVectors(UP, dir).normalize();
    const dist = this.overview.position.distanceTo(this.overview.target) * 0.62;
    // El objetivo se corre a la derecha para que el toten quede a la izquierda del panel.
    const target = new THREE.Vector3(p.x, 2.1, p.z).addScaledVector(right, 3.4);
    return { position: target.clone().addScaledVector(dir, dist), target };
  }
}
