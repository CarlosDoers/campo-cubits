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
import { COL_PITCH } from './HeavyHex';
import { Ground } from './Ground';
import { PALETTE } from '../palette';
import { easeTo } from './helpers';

interface Pose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

/**
 * Plano general. La cámara se queda **baja y cerca**: el chip se ve casi de canto, ocupa
 * la mitad inferior del encuadre y su borde cercano se sale por los lados. Se encuadra
 * por el ancho a la altura del centro, no por la diagonal: como ya no gira, el caso peor
 * no es la diagonal sino el propio ancho, y dejar que el borde cercano rebose es lo que
 * da la perspectiva.
 */
const OVERVIEW_PITCH = 0.3;
const OVERVIEW_FILL = 0.8; // parte del ancho del encuadre que ocupa el chip a media distancia
const OVERVIEW_RAISE = 0.9; // se sube el objetivo para que el chip caiga en la mitad de abajo
/** Lo que el sustrato sobresale de la retícula por cada lado (ver `Ground`). */
const DIE_MARGIN = 1.3;
/** Por debajo de este ancho el panel se va abajo y no hay que correr nada. */
const NARROW_PX = 760;
/**
 * Inclinación al enfocar un territorio: **picado**, al revés que el plano general.
 * Rasante (iba a 0,42 rad) las dos filas se aplastaban una contra otra y el subnivel no
 * se leía como una fila encima de su sección, sino como un montón. Desde arriba la
 * separación vertical entre filas sale casi el doble que el paso entre columnas y la
 * retícula se lee como lo que es. Debe quedar dentro del rango de los controles
 * (`minPolarAngle`), o lo recortarían al soltar la cámara.
 */
const FOCUS_PITCH = 1.0;
/**
 * Sitio en pantalla que necesita la etiqueta de una subsección. La cámara se acerca hasta
 * que **una columna del chip ocupa estos píxeles**: así las etiquetas caben seguidas
 * encima de cada esfera sin tener que separar las esferas entre sí, que era el apaño de
 * antes. Y de paso el vuelo se nota mucho más, que es la gracia.
 */
const LABEL_ROOM = 235;
/** Ancho del panel de sección (ver `style.css`): media rendija es lo que hay que correr. */
const PANEL_PX = 380;
/** Altura del objetivo y reparto entre las dos filas: la sección abajo, las hijas encima. */
const TARGET_Y = 0.7;
const TARGET_LERP = 0.55;
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
      const frame = this.field.hubFrame(item.id);
      if (frame) this.flyTo(this.focusPose(frame));
    } else {
      this.overlay.hide();
      this.flyTo(this.overview);
    }
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

    this.field.update(dt, this.focus);
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
    const halfW = width / 2 + DIE_MARGIN;
    const halfD = depth / 2 + DIE_MARGIN;
    // En vertical manda el borde cercano, que está `halfD·cos` más cerca de la cámara y
    // por eso se proyecta mucho más grande. En horizontal, el ancho a media distancia.
    const distV =
      (halfD * Math.sin(OVERVIEW_PITCH) + OVERVIEW_RAISE) / Math.tan(vFov / 2) +
      halfD * Math.cos(OVERVIEW_PITCH);
    const distH = halfW / (OVERVIEW_FILL * Math.tan(hFov / 2));
    const dist = Math.max(distV, distH);
    this.overview.target.set(0, OVERVIEW_RAISE, 0);
    this.overview.position.set(
      0,
      OVERVIEW_RAISE + dist * Math.sin(OVERVIEW_PITCH),
      dist * Math.cos(OVERVIEW_PITCH),
    );
  }

  /**
   * Enfoque de un territorio: la camara baja y se acerca, pero **sin dejar de ver el
   * chip**. El toten queda a la izquierda para dejarle sitio al panel.
   */
  /**
   * Encuadre de una sección abierta. El azimut se **fija mirando desde +Z**, no se
   * conserva el actual: las filas del chip tienen que salir horizontales para que la fila
   * de las hijas quede de verdad encima de la sección. Y la cámara se acerca a encajar
   * solo esas dos filas.
   */
  private focusPose(f: { hub: THREE.Vector3; children: THREE.Vector3; span: number }): Pose {
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    // Distancia a la que una columna ocupa `LABEL_ROOM` píxeles. Se pide algo más de lo
    // que mide una etiqueta porque las hijas quedan por detrás del objetivo de la cámara
    // y se proyectan algo más pequeñas que a la distancia con la que se calcula.
    const visibleWidth = (this.container.clientWidth / LABEL_ROOM) * COL_PITCH;
    const byLabels = visibleWidth / 2 / Math.tan(hFov / 2);
    // Y la mínima para que el grupo entero quepa de todas formas, por si el encuadre es
    // muy estrecho y acercarse tanto dejaría las hijas de los extremos fuera.
    const halfW = f.span / 2 + 1.1;
    const halfD = Math.abs(f.hub.z - f.children.z) / 2 + 0.9;
    const byFit =
      Math.max((halfD * Math.sin(FOCUS_PITCH)) / Math.tan(vFov / 2), halfW / Math.tan(hFov / 2)) +
      halfD * Math.cos(FOCUS_PITCH);
    const dist = Math.max(byLabels, byFit);

    // El objetivo cae entre las dos filas, algo más cerca de las hijas para que la
    // sección quede abajo. En horizontal se centra en la **sección**, no en el punto
    // medio del grupo: el encargo era que la opción marcada quede abajo en el centro.
    //
    // Y el desplazamiento del panel se calcula a la profundidad de la sección, que va por
    // delante del objetivo: la misma distancia en el mundo la corre bastante más en
    // pantalla, y con un valor fijo se iba medio encuadre a la izquierda.
    const rowGap = f.hub.z - f.children.z;
    const depthHub =
      dist + TARGET_Y * Math.sin(FOCUS_PITCH) - rowGap * TARGET_LERP * Math.cos(FOCUS_PITCH);
    const shift =
      window.innerWidth < NARROW_PX
        ? 0
        : (PANEL_PX / this.container.clientWidth) * Math.tan(hFov / 2) * depthHub;
    const target = new THREE.Vector3(
      f.hub.x + shift,
      TARGET_Y,
      THREE.MathUtils.lerp(f.hub.z, f.children.z, TARGET_LERP),
    );
    return {
      position: new THREE.Vector3(
        target.x,
        target.y + dist * Math.sin(FOCUS_PITCH),
        target.z + dist * Math.cos(FOCUS_PITCH),
      ),
      target,
    };
  }
}
