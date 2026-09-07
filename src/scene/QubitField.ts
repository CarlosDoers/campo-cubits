import * as THREE from 'three';
import type { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { SubItem, Territory } from '../menu';
import { COLS, hasBridge, heavyHex, type QubitNode, type Topology } from './HeavyHex';
import { Circuit } from './Circuit';
import { easeTo, glowSprite, makeLabel, radialTexture } from './helpers';
import { PALETTE } from '../palette';

export type HitInfo =
  | { kind: 'item'; itemId: string }
  | { kind: 'sub'; itemId: string; subId: string }
  | { kind: 'qubit'; index: number };

/**
 * Arranque. Es lo primero que ve nadie, así que en vez de encender los cúbits por orden
 * de índice se hace en tres tiempos: primero el sustrato se dibuja solo (`Ground`),
 * después un **frente de encendido** cruza el chip en diagonal y va levantando los
 * cúbits desde debajo del sustrato, y los acopladores prenden justo detrás. Cada cúbit
 * da un destello al llegar arriba y remata con un pequeño rebote.
 */
const BOOT_LEAD = 0.55; // lo que se espera a que el sustrato se dibuje
const BOOT_SWEEP = 1.9; // lo que tarda el frente en cruzar el chip
const BOOT_RISE = 0.55; // lo que tarda un cúbit en subir y encenderse
const BOOT_DROP = 1.3; // desde dónde sube, por debajo del sustrato
const REST_DIM = 0.24; // intensidad que conserva lo no enfocado: el chip sigue a la vista
const IDLE = 0.85; // brillo de un cúbit en reposo (las puertas ya no destellan, no hace falta dejarles sitio)
const BASE_Y = 0.55; // altura a la que flota la retícula sobre el sustrato
const BREATH = 0.045; // respiración vertical; no hay deriva horizontal, la retícula es exacta
/**
 * El subnivel **no saca esferas nuevas**: activa cúbits que ya están en el chip. La
 * sección vive en una fila y sus hijas en la fila de arriba, y lo que las une es el
 * **puente** real de la retícula más los acopladores de esa fila. Al abrirla se enciende
 * ese camino, así que el menú se dibuja con la topología de la máquina en vez de con
 * geometría inventada encima.
 */
const HOVER_PREVIEW = 0.8; // cuánto se enciende un subnivel con solo señalar su sección
/**
 * El subnivel no se enciende de golpe: la luz **viaja** desde la sección, sube por el
 * puente y recorre la fila de arriba, un salto detrás de otro. Cada cúbit se pasa un poco
 * de brillo al llegarle y se asienta, que es lo que hace que parezca que algo corre por
 * el cable en vez de que alguien haya subido un regulador.
 */
const HOP_DELAY = 0.07; // retardo por salto de acoplador
const LIT_RISE = 0.16; // lo que tarda un cúbit en encenderse
const LIT_PULSE = 0.55; // sobre-brillo al llegarle la luz
const LIT_SETTLE = 5.5; // con qué rapidez se asienta ese sobre-brillo
/**
 * Al abrir, las subsecciones **no se mueven en absoluto**: ni se elevan ni se separan. Se
 * quedan exactamente donde están en la retícula y solo se encienden. De que quepan sus
 * etiquetas se encarga la cámara, acercándose (ver `focusPose` en `App`).
 */
/**
 * Altura de la etiqueta sobre su cúbit. Va corta a propósito: con la cámara metida en el
 * plano, una etiqueta a media unidad de su esfera se despega tanto que deja de leerse
 * como su nombre y parece un rótulo suelto.
 */
const SUB_LABEL_Y = 0.42;
/**
 * El nombre del territorio va justo encima de su cúbit, igual que los de las hijas. Antes
 * flotaba más alto, pero ahora que las hijas no se elevan esa altura alcanzaba su banda de
 * etiquetas y chocaba con una de ellas.
 */
const HUB_LABEL_Y = 0.75;
/*
 * Abierta, esta etiqueta **se apaga** (lo hace el CSS, con `.hub-label.selected`): el
 * nombre pasa a leerse a cuerpo de titular en el margen izquierdo. Antes se intentó
 * colocarla encima —no cabe, el hueco entre las dos filas se lo reparten el cúbit puente
 * y su acoplador— y luego delante de la esfera; las dos veces el mismo nombre acababa
 * dicho tres veces en la misma pantalla.
 */
const HUB_BEAM_H = 0.6; // altura del haz, a juego
const QUBIT_SIZE = 0.17;
const BRIDGE_SIZE = 0.11; // los cúbits puente son de grado 2: más pequeños, como en los diagramas de IBM
const HUB_SIZE = 0.28;
const SUB_SIZE = 0.23;
const COUPLER_W = 0.04; // grosor de la barra de acoplador, a juego con el tamaño de los cúbits
const BASE = new THREE.Color(PALETTE.quiet); // el cúbit en reposo no emite luz
const COUPLER = new THREE.Color(PALETTE.line); // los acopladores son estructura
const ACCENT = new THREE.Color(PALETTE.accent);
const TEXT = new THREE.Color(PALETTE.text);
/**
 * La medida se codifica con **un solo color**: los cúbits que salen a |1⟩ se encienden
 * con el acento y los que salen a |0⟩ se apagan hasta el color de línea. Antes eran rosa
 * y azul, dos colores más para una paleta que ya tenía cinco. Con uno, el patrón medido
 * se lee igual de bien —encendidos contra apagados— y no añade ruido.
 */
const READ_ONE = ACCENT;
const READ_ZERO = new THREE.Color(PALETTE.line);

interface Qubit {
  node: QubitNode;
  /** Sitio en el frente de encendido, 0..1 según su posición en la diagonal. */
  bootDelay: number;
  size: number;
  pos: THREE.Vector3;
  lift: number;
  /** Desplazamiento horizontal al subir a la columna de su territorio. */
  sx: number;
  sz: number;
  hover: number;
  /** Destello de lectura ya suavizado: quita el golpe seco del encendido. */
  pulseVis: number;
  /** Los cúbits-tótem amortiguan el destello para no perder su color. */
  damp: number;
  scale: number;
  targetScale: number;
  color: THREE.Color;
  targetColor: THREE.Color;
}

interface SubNode {
  sub: SubItem;
  /** Cúbit del chip que representa esta subsección. No se mueve: se enciende. */
  index: number;
  hit: THREE.Mesh;
  label: CSS2DObject;
  /** Empujón vertical en pantalla para no pisar a otra etiqueta. */
  dy: number;
}

interface Hub {
  item: Territory;
  index: number;
  /** Acopladores del camino que baja de la fila de arriba: puente y tramo de fila. */
  path: number[];
  /** Saltos desde la sección hasta cada cúbit del camino: marca cuándo le llega la luz. */
  hops: Array<[number, number]>;
  /** Segundos que lleva encendiéndose, o 0 si está apagado. */
  litT: number;
  color: THREE.Color;
  group: THREE.Group;
  ringMat: THREE.MeshBasicMaterial;
  beamMat: THREE.MeshBasicMaterial;
  glow: THREE.Sprite;
  hit: THREE.Mesh;
  label: CSS2DObject;
  /** Empujón vertical en pantalla, igual que en las subsecciones. */
  dy: number;
  scale: number;
  active: number;
  subs: SubNode[];
}

const invisible = () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
const FORWARD = new THREE.Vector3(0, 0, 1); // eje largo de la barra de acoplador

/**
 * El chip: los 156 cúbits en su retícula heavy-hex exacta —sin desorden, para que se
 * lean los hexágonos— unidos por barras de acoplador, con un **circuito ejecutándose
 * encima**: capas de puertas, CZ encendiendo acopladores y un barrido de medida.
 *
 * Los territorios son cúbits-tótem con un haz vertical. Al pulsar uno, sus subsecciones
 * se elevan **en vertical justo encima**, sin rayos largos que crucen el campo, y el
 * circuito sigue corriendo por debajo: el chip no deja de trabajar.
 */
export class QubitField {
  readonly group = new THREE.Group();
  readonly topology: Topology;
  readonly circuit: Circuit;

  private readonly qubits: Qubit[] = [];
  private readonly hubs: Hub[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly hitMesh: THREE.InstancedMesh;
  private readonly halos: THREE.Points;
  private readonly couplers: THREE.InstancedMesh;
  private readonly tooltip: CSS2DObject;
  private hovered: HitInfo | null = null;
  private selectedId: string | null = null;
  private time = 0;
  private readonly dummy = new THREE.Object3D();
  private readonly tmpColor = new THREE.Color();
  private readonly tmpA = new THREE.Vector3();
  /** `fila:columna:puente` → índice de cúbit. */
  private readonly byCell = new Map<string, number>();
  /** `a:b` (a < b) → índice de acoplador. */
  private readonly edgeAt = new Map<string, number>();
  /**
   * Encendido del subnivel, recalculado cada fotograma: el camino del territorio abierto
   * y, al señalar una subsección, lo que se propaga desde ella por los acopladores. Se
   * guarda por cúbit y de ahí se deduce el de cada acoplador —una barra se enciende si
   * lo están sus dos extremos—, que es más barato y da el mismo resultado.
   */
  private readonly linkQubit: Float32Array;
  private readonly linkEdge: Float32Array;
  private readonly linkTarget: Float32Array;
  /** Cuánta atención se lleva ahora mismo un subnivel (señalado o abierto), 0..1. */
  private attention = 0;

  constructor(items: Territory[], expectedCount: number) {
    this.topology = heavyHex();
    const n = this.topology.nodes.length;
    if (n !== expectedCount) throw new Error(`La retícula tiene ${n} cúbits, se esperaban ${expectedCount}`);
    this.circuit = new Circuit(this.topology);

    for (const node of this.topology.nodes) {
      this.qubits.push({
        node,
        bootDelay: 0,
        size: node.bridge ? BRIDGE_SIZE : QUBIT_SIZE,
        pos: new THREE.Vector3(node.x, BASE_Y, node.z),
        lift: 0,
        sx: 0,
        sz: 0,
        hover: 0,
        pulseVis: 0,
        damp: 1,
        scale: node.bridge ? BRIDGE_SIZE : QUBIT_SIZE,
        targetScale: node.bridge ? BRIDGE_SIZE : QUBIT_SIZE,
        color: BASE.clone(),
        targetColor: BASE.clone(),
      });
    }

    // El frente entra en diagonal: se proyecta cada cúbit sobre esa dirección y se
    // normaliza contra el rango real, para que barra el chip entero de punta a punta.
    const proj = this.qubits.map((q) => q.node.x * 0.72 + q.node.z * 0.69);
    const lo = Math.min(...proj);
    const span = Math.max(...proj) - lo || 1;
    this.qubits.forEach((q, i) => {
      q.bootDelay = (proj[i] - lo) / span;
    });

    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    this.hitMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.24, 6, 5), invisible(), n);
    for (let i = 0; i < n; i++) this.mesh.setColorAt(i, BASE);

    for (const node of this.topology.nodes) {
      this.byCell.set(`${node.row}:${node.col}:${node.bridge ? 1 : 0}`, node.index);
    }
    this.topology.edges.forEach(([a, b], e) => {
      this.edgeAt.set(a < b ? `${a}:${b}` : `${b}:${a}`, e);
    });

    this.linkQubit = new Float32Array(n);
    this.linkEdge = new Float32Array(this.topology.edges.length);
    this.linkTarget = new Float32Array(n);

    this.halos = this.buildHalos(n);
    this.couplers = this.buildCouplers();
    this.tooltip = makeLabel('', 'qubit-tip');
    this.tooltip.visible = false;

    this.group.add(this.mesh, this.hitMesh, this.halos, this.couplers, this.tooltip);
    this.buildHubs(items);
  }

  /** Cúbits ya "encendidos" durante la animación de arranque. */
  get booted(): number {
    let n = 0;
    for (let i = 0; i < this.qubits.length; i++) if (this.bootOf(i) > 0.5) n++;
    return n;
  }

  /** Mientras dura el arranque el circuito espera: primero se enciende la máquina. */
  get booting(): boolean {
    return this.time < BOOT_LEAD + BOOT_SWEEP + BOOT_RISE;
  }

  get selected(): string | null {
    return this.selectedId;
  }

  /**
   * Encuadre de una sección: dónde está ella y dónde queda la fila de sus hijas, para que
   * la cámara pueda dejarla abajo en el centro con el subnivel encima.
   */
  hubFrame(id: string): { hub: THREE.Vector3; children: THREE.Vector3; span: number } | null {
    const h = this.hubs.find((x) => x.item.id === id);
    if (!h) return null;
    const hq = this.topology.nodes[h.index];
    const xs = h.subs.map((s) => this.topology.nodes[s.index].x);
    const cz = h.subs.length ? this.topology.nodes[h.subs[0].index].z : hq.z;
    return {
      hub: new THREE.Vector3(hq.x, 0, hq.z),
      children: new THREE.Vector3((Math.min(...xs) + Math.max(...xs)) / 2, 0, cz),
      span: Math.max(...xs) - Math.min(...xs),
    };
  }

  hitTargets(): THREE.Object3D[] {
    const sel = this.hubs.find((h) => h.item.id === this.selectedId);
    return [...this.hubs.map((h) => h.hit), ...(sel?.subs.map((s) => s.hit) ?? []), this.hitMesh];
  }

  resolveHit(hit: THREE.Intersection): HitInfo | null {
    if (hit.object === this.hitMesh) {
      return hit.instanceId === undefined ? null : { kind: 'qubit', index: hit.instanceId };
    }
    const data = hit.object.userData as Partial<HitInfo>;
    return data.kind ? (data as HitInfo) : null;
  }

  setHovered(hit: HitInfo | null): void {
    if (sameHit(hit, this.hovered)) return;
    this.toggleHover(this.hovered, false);
    this.hovered = hit;
    this.toggleHover(hit, true);
    if (hit?.kind === 'qubit') {
      const bit = this.circuit.bits[hit.index];
      const read = bit < 0 ? '' : ` · |${bit}⟩`;
      (this.tooltip.element.firstChild as HTMLElement).textContent = `Q·${String(hit.index).padStart(3, '0')}${read}`;
    }
  }

  select(id: string | null): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    for (const hub of this.hubs) {
      hub.label.element.classList.toggle('selected', hub.item.id === id);
      hub.label.element.classList.toggle('dim', id !== null && hub.item.id !== id);
    }
  }

  /**
   * `focus` va de 0 (plano general) a 1 (territorio enfocado: el resto se atenúa).
   */
  update(dt: number, focus: number): void {
    this.time += dt;
    const t = this.time;
    const rest = 1 - (1 - REST_DIM) * focus;
    const hoverIndex = this.hoverIndex();

    if (!this.booting) this.circuit.update(dt);
    this.updateLinks(dt);


    // --- estado por defecto de cada cúbit; los territorios lo sobrescriben ---
    this.qubits.forEach((q, i) => {
      q.lift = 0;
      q.sx = 0;
      q.sz = 0;
      // El encendido engorda el cúbit además de teñirlo: la medida usa el mismo acento,
      // así que hace falta un canal que no sea el color para distinguirlos.
      q.targetScale = q.size * (1 + 0.55 * this.linkQubit[i]);
      q.targetColor.copy(BASE).multiplyScalar(IDLE * rest);
    });

    // --- territorios y subsecciones: objetivos ---
    for (const hub of this.hubs) {
      const isSel = hub.item.id === this.selectedId;
      const isHover = this.hovered?.kind === 'item' && this.hovered.itemId === hub.item.id;
      // Si los cinco tótems brillan a la vez, ninguno destaca: en reposo son un punto
      // apagado y el brillo se lo gana el elegido.
      const attention = isSel ? 1 : isHover ? 0.6 : 0.2;
      const k = attention * (isSel ? 1 : rest);
      // Abierta, la sección crece poco: ya está en primer plano y la perspectiva la
      // agranda un 45 % de más sobre la fila de las hijas. Con el 1,3 de antes salía una
      // bola blanca del tamaño de un tercio del encuadre.
      hub.scale = easeTo(hub.scale, isSel ? 1.15 : isHover ? 1.2 : 1, dt, 8);
      hub.active = easeTo(hub.active, isSel ? 1 : 0, dt, 4);

      const q = this.qubits[hub.index];
      q.targetScale = HUB_SIZE * hub.scale;
      q.targetColor.copy(hub.color).multiplyScalar((0.3 + 0.7 * attention) * (isSel ? 1 : rest));

      const boot = this.bootOf(hub.index);
      hub.group.visible = boot > 0.01;
      hub.group.scale.setScalar(boot);
      hub.ringMat.opacity = 0.7 * k;
      hub.beamMat.opacity = 0.3 * k * (1 - hub.active); // abierto no queda ninguna línea
      // El halo va al cuadrado: en reposo desaparece del todo en vez de quedarse tenue.
      hub.glow.material.opacity = 0.5 * attention * attention * (isSel ? 1 : rest);
      hub.label.visible = boot > 0.5;
      hub.label.position.y = HUB_LABEL_Y;

      // Las subsecciones son cúbits del propio chip: no aparecen de la nada, se activan
      // donde están. Al abrir la sección se **elevan y se separan entre sí** lo justo
      // para que su etiqueta quepa encima de cada una.
      for (const s of hub.subs) {
        const sq = this.qubits[s.index];
        sq.targetScale = sq.size + (SUB_SIZE - sq.size) * hub.active;
        sq.targetColor.copy(BASE).multiplyScalar(IDLE * rest).lerp(TEXT, hub.active);
      }
    }

    // --- posiciones y apariencia de los 156 cúbits ---
    const haloPos = this.halos.geometry.getAttribute('position') as THREE.BufferAttribute;
    const haloCol = this.halos.geometry.getAttribute('color') as THREE.BufferAttribute;
    this.qubits.forEach((q, i) => {
      const boot = this.bootOf(i);
      q.hover = easeTo(q.hover, i === hoverIndex ? 1 : 0, dt, 10);
      q.scale = easeTo(q.scale, q.targetScale * (1 + 0.5 * q.hover), dt, 8);
      q.color.lerp(q.targetColor, Math.min(1, dt * 6));

      // Respiración coherente, solo vertical: la retícula no se desalinea nunca.
      const breathe = BREATH * Math.sin(t * 0.8 + q.node.x * 0.35 + q.node.z * 0.22);
      q.pos.set(
        q.node.x + q.sx,
        BASE_Y + breathe + q.lift + 0.16 * q.hover - BOOT_DROP * (1 - backOut(boot)),
        q.node.z + q.sz,
      );

      // Destello al encenderse: una campana que sube y baja durante la subida.
      const ignition = 4 * boot * (1 - boot);
      q.pulseVis = easeTo(q.pulseVis, Math.max(this.circuit.pulse[i] * q.damp, ignition), dt, 13);
      const gate = q.pulseVis * rest;
      const read = this.circuit.readout[i];
      this.dummy.position.copy(q.pos);
      this.dummy.scale.setScalar(q.scale * (1 + 0.35 * gate) * boot);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);

      // Color: base → destello blanco de la puerta → color del bit medido.
      const link = this.linkQubit[i];
      this.tmpColor
        .copy(q.color)
        .lerp(ACCENT, Math.min(1, link) * 0.85)
        // El refuerzo del encendido se quedó en la mitad: de lejos daba igual, pero con
        // la cámara encima un cúbit al 1,4 se sale de rango, se come su propio contorno y
        // el bloom lo convierte en una mancha.
        .multiplyScalar(1 + 0.85 * gate + 0.22 * link)
        .lerp(TEXT, gate * 0.45);
      if (read > 0) {
        this.tmpColor.lerp(this.circuit.bits[i] === 1 ? READ_ONE : READ_ZERO, read * 0.9 * rest * (1 - 0.75 * this.attention));
      }
      this.mesh.setColorAt(i, this.tmpColor);

      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.hitMesh.setMatrixAt(i, this.dummy.matrix);

      haloPos.setXYZ(i, q.pos.x, q.pos.y, q.pos.z);
      // El halo ya no es ambiente: casi nada en reposo, y solo asoma con la lectura o al
      // pasar el ratón. Antes los 156 llevaban un aditivo permanente encima.
      this.tmpColor.multiplyScalar((0.05 + 0.5 * gate + 0.45 * read * rest * (1 - 0.75 * this.attention) + 0.4 * q.hover + 0.3 * link) * boot);
      haloCol.setXYZ(i, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.hitMesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    haloPos.needsUpdate = true;
    haloCol.needsUpdate = true;

    // --- acopladores del camino: siguen a las subsecciones cuando se elevan ---
    // El resto tiene geometría fija; estos se recolocan porque sus extremos se mueven.
    for (const hub of this.hubs) for (const e of hub.path) this.orientCoupler(e);
    this.couplers.instanceMatrix.needsUpdate = true;

    // --- acopladores: el color cambia con el encendido del subnivel ---
    this.topology.edges.forEach(([a, b], e) => {
      const boot = Math.min(this.bootOf(a), this.bootOf(b));
      this.tmpColor
        .copy(COUPLER)
        .lerp(ACCENT, Math.min(1, this.linkEdge[e]) * 0.9)
        .multiplyScalar((1 + 1.5 * this.linkEdge[e]) * rest * boot);
      this.couplers.setColorAt(e, this.tmpColor);
    });
    if (this.couplers.instanceColor) this.couplers.instanceColor.needsUpdate = true;

    // --- territorios y subsecciones: colocación final ---
    for (const hub of this.hubs) {
      const isSel = hub.item.id === this.selectedId;
      const hq = this.qubits[hub.index];
      // Las etiquetas y los marcadores se anclan a la altura de reposo, **sin** la
      // respiración vertical del cúbit. Es un movimiento de cuatro píxeles, pero hace que
      // el reparto de etiquetas lo persiga en vez de converger, y deja solapes sueltos.
      hub.group.position.set(hq.pos.x, BASE_Y, hq.pos.z);
      const a = hub.active;

      for (const s of hub.subs) {
        const q = this.qubits[s.index];
        s.hit.position.copy(q.pos);
        s.hit.visible = isSel;
        s.label.position.set(q.pos.x, BASE_Y + SUB_LABEL_Y, q.pos.z);
        s.label.visible = isSel && a > 0.6;
      }
      if (isSel) this.separateLabels(hub, dt);
    }

    if (this.hovered?.kind === 'qubit') {
      const q = this.qubits[this.hovered.index];
      this.tooltip.position.set(q.pos.x, q.pos.y + 0.3, q.pos.z);
      this.tooltip.visible = true;
    } else {
      this.tooltip.visible = false;
    }
  }

  // ---------- construcción ----------

  /**
   * Enciende el camino que cuelga el subnivel de su sección, y la propagación desde la
   * subsección señalada: sus vecinos en el mapa de acoplamiento se encienden a dos
   * saltos, cada vez menos. Es el "efecto de conexión" con la retícula de verdad.
   */
  private updateLinks(dt: number): void {
    const target = this.linkTarget;
    target.fill(0);

    for (const hub of this.hubs) {
      const isSel = hub.item.id === this.selectedId;
      const isHover = this.hovered?.kind === 'item' && this.hovered.itemId === hub.item.id;
      // Señalar una sección ya enciende su subnivel: es el adelanto de lo que hay dentro.
      // Abrirla lo enciende del todo.
      const level = isSel ? hub.active : isHover ? HOVER_PREVIEW : 0;
      hub.litT = level > 0 ? hub.litT + dt : 0;
      if (level <= 0) continue;

      // Cada cúbit del camino entra cuando le llega la luz, no todos a la vez. Los
      // acopladores se deducen de sus extremos, así que se encienden solos por detrás.
      for (const [i, hop] of hub.hops) {
        target[i] = Math.max(target[i], level * this.arrival(hub.litT, hop));
      }
    }

    // La medida del circuito pinta medio chip con este mismo acento; mientras se mira un
    // subnivel se aparta, o el adelanto se pierde entre el ruido de fondo.
    this.attention = easeTo(this.attention, Math.max(...this.hubs.map((h) => (
      h.item.id === this.selectedId ? h.active : this.hovered?.kind === 'item' && this.hovered.itemId === h.item.id ? HOVER_PREVIEW : 0
    )), 0), dt, 6);

    const up = Math.min(1, dt * 16);
    const down = Math.min(1, dt * 5);
    for (let i = 0; i < this.linkQubit.length; i++) {
      const cur = this.linkQubit[i];
      this.linkQubit[i] += (target[i] - cur) * (target[i] > cur ? up : down);
    }
    this.topology.edges.forEach(([a, b], e) => {
      this.linkEdge[e] = Math.min(this.linkQubit[a], this.linkQubit[b]);
    });
  }

  private buildHalos(n: number): THREE.Points {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    return new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.7,
        map: radialTexture([
          [0, 'rgba(255,255,255,1)'],
          [0.3, 'rgba(255,255,255,0.4)'],
          [1, 'rgba(255,255,255,0)'],
        ]),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
  }

  /**
   * Los 176 acopladores como barras finas, no como hilos de un píxel: es lo que hace
   * legible la retícula heavy-hex y lo que permite encender una CZ concreta. La
   * retícula no se mueve en horizontal, así que la geometría se calcula una sola vez.
   */
  private buildCouplers(): THREE.InstancedMesh {
    const edges = this.topology.edges;
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 1, depthWrite: false }),
      edges.length,
    );
    edges.forEach(([a, b], e) => {
      const qa = this.topology.nodes[a];
      const qb = this.topology.nodes[b];
      const dx = qb.x - qa.x;
      const dz = qb.z - qa.z;
      const len = Math.hypot(dx, dz);
      this.dummy.position.set((qa.x + qb.x) / 2, BASE_Y, (qa.z + qb.z) / 2);
      this.dummy.rotation.set(0, Math.atan2(dx, dz), 0);
      this.dummy.scale.set(COUPLER_W, COUPLER_W * 0.5, len);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(e, this.dummy.matrix);
      mesh.setColorAt(e, COUPLER);
    });
    this.dummy.rotation.set(0, 0, 0);
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  /**
   * Coloca las secciones y cuelga de cada una su subnivel usando la retícula real.
   *
   * Una sección va en un cúbit de fila que **tenga puente hacia la fila de arriba**; sus
   * hijas son cúbits consecutivos de esa fila de arriba, centrados en la columna del
   * puente. El camino que las une —el puente más el tramo de fila— se guarda para
   * encenderlo al abrir: el subnivel se dibuja con los acopladores de la máquina.
   */
  private buildHubs(items: Territory[]): void {
    const used = new Set<number>();
    // Sirven las filas 1..7 (hace falta una fila encima) cuya columna tenga puente.
    const candidates = this.topology.nodes.filter(
      (n) => !n.bridge && n.row > 0 && hasBridge(n.row - 1, n.col),
    );

    items.forEach((item, k) => {
      // Repartidas en elipse sobre el chip, como antes, pero solo entre las candidatas.
      const ang = -Math.PI / 2 - 0.25 + (k / items.length) * Math.PI * 2;
      const tx = Math.cos(ang) * this.topology.width * 0.34;
      const tz = Math.sin(ang) * this.topology.depth * 0.34;
      let index = -1;
      let bestD = Infinity;
      for (const n of candidates) {
        if (used.has(n.index)) continue;
        const d = (n.x - tx) ** 2 + (n.z - tz) ** 2;
        if (d < bestD) {
          bestD = d;
          index = n.index;
        }
      }
      used.add(index);

      const node = this.topology.nodes[index];
      const n = item.items.length;
      // Ventana de `n` columnas consecutivas en la fila de arriba, centrada en la del
      // puente y recortada a los bordes del chip.
      const start = Math.max(0, Math.min(COLS - n, node.col - Math.floor((n - 1) / 2)));
      const childCols = Array.from({ length: n }, (_, j) => start + j);

      const path: number[] = [];
      const bridge = this.cell(node.row - 1, node.col, true);
      const above = this.cell(node.row - 1, node.col, false);
      if (bridge >= 0) {
        this.pushEdge(path, index, bridge);
        this.pushEdge(path, bridge, above);
      }
      // Tramo de la fila de arriba entre la columna del puente y los extremos.
      const lo = Math.min(node.col, childCols[0]);
      const hi = Math.max(node.col, childCols[n - 1]);
      for (let c = lo; c < hi; c++) {
        this.pushEdge(path, this.cell(node.row - 1, c, false), this.cell(node.row - 1, c + 1, false));
      }

      const color = ACCENT.clone();
      const q = this.qubits[index];
      q.damp = 0.3;
      q.scale = q.targetScale = HUB_SIZE;
      q.color.copy(color);
      q.targetColor.copy(color);

      const group = new THREE.Group();
      group.position.copy(q.pos);
      group.visible = false;

      const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.012, 6, 48), ringMat);
      ring.rotation.x = Math.PI / 2;
      const beamMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.07, HUB_BEAM_H, 8, 1, true), beamMat);
      beam.position.y = HUB_BEAM_H / 2;
      const glow = glowSprite(toRgba(ACCENT), 1.1, 0.4);
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), invisible());
      hit.userData = { kind: 'item', itemId: item.id } satisfies HitInfo;
      const label = makeLabel(item.label, 'hub-label');
      label.position.y = HUB_LABEL_Y;
      group.add(ring, beam, glow, hit, label);
      this.group.add(group);

      const subs = item.items.map((sub, j) => {
        const i = this.cell(node.row - 1, childCols[j], false);
        used.add(i);
        const shit = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 8), invisible());
        shit.visible = false;
        shit.userData = { kind: 'sub', itemId: item.id, subId: sub.id } satisfies HitInfo;
        const slabel = makeLabel(sub.label, 'sub-label');
        slabel.visible = false;
        this.group.add(shit, slabel);
        return { sub, index: i, hit: shit, label: slabel, dy: 0 };
      });

      this.hubs.push({ item, index, path, hops: this.hopsAlong(index, path), litT: 0, color, group, ringMat, beamMat, glow, hit, label, dy: 0, scale: 1, active: 0, subs });
    });
  }

  /** Recoloca la barra de un acoplador entre las posiciones actuales de sus extremos. */
  private orientCoupler(e: number): void {
    const [a, b] = this.topology.edges[e];
    const pa = this.qubits[a].pos;
    const pb = this.qubits[b].pos;
    this.tmpA.copy(pb).sub(pa);
    const len = this.tmpA.length();
    if (len < 1e-5) return;
    this.dummy.position.copy(pa).lerp(pb, 0.5);
    this.dummy.quaternion.setFromUnitVectors(FORWARD, this.tmpA.divideScalar(len));
    this.dummy.scale.set(COUPLER_W, COUPLER_W * 0.5, len);
    this.dummy.updateMatrix();
    this.couplers.setMatrixAt(e, this.dummy.matrix);
  }

  /**
   * Saltos desde la sección hasta cada cúbit del camino, recorriendo **solo** ese camino.
   * Se calcula con un recorrido en anchura sobre el subgrafo, y no a mano, porque la
   * ventana de hijas se recorta contra el borde del chip y entonces la columna del puente
   * puede quedarse fuera: contando a mano saldrían mal justo en los casos de los extremos.
   */
  private hopsAlong(from: number, path: number[]): Array<[number, number]> {
    const adj = new Map<number, number[]>();
    const link = (a: number, b: number) => {
      const l = adj.get(a);
      if (l) l.push(b);
      else adj.set(a, [b]);
    };
    for (const e of path) {
      const [a, b] = this.topology.edges[e];
      link(a, b);
      link(b, a);
    }
    const hop = new Map<number, number>([[from, 0]]);
    const queue = [from];
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head];
      for (const j of adj.get(i) ?? []) {
        if (hop.has(j)) continue;
        hop.set(j, hop.get(i)! + 1);
        queue.push(j);
      }
    }
    return [...hop];
  }

  /** Cuánto lleva encendido un cúbit al que la luz le llega tras `hop` saltos. */
  private arrival(litT: number, hop: number): number {
    const u = litT - hop * HOP_DELAY;
    if (u <= 0) return 0;
    const rise = THREE.MathUtils.smoothstep(u / LIT_RISE, 0, 1);
    // Sobre-brillo que decae: el cúbit se pasa al encenderse y luego se asienta.
    return rise * (1 + LIT_PULSE * Math.exp(-Math.max(0, u - LIT_RISE) * LIT_SETTLE));
  }

  /** Índice del cúbit en (fila, columna), o -1. */
  private cell(row: number, col: number, bridge: boolean): number {
    return this.byCell.get(`${row}:${col}:${bridge ? 1 : 0}`) ?? -1;
  }

  /** Añade al camino el acoplador entre dos cúbits, si existe. */
  private pushEdge(path: number[], a: number, b: number): void {
    if (a < 0 || b < 0) return;
    const e = this.edgeAt.get(a < b ? `${a}:${b}` : `${b}:${a}`);
    if (e !== undefined) path.push(e);
  }

  // ---------- utilidades ----------

  /**
   * Red de seguridad: la cámara se acerca lo justo para que las etiquetas de las hijas
   * quepan seguidas, pero eso depende del texto y de la forma de la ventana. En un
   * encuadre muy bajo y ancho la cámara tiene que retroceder para que quepan las dos
   * filas, las columnas se estrechan y las etiquetas se rozan. Entonces esto las escalona.
   *
   * Se recorren **en su orden de la retícula**, de izquierda a derecha, y cada una pasa
   * por encima de las anteriores con las que se cruce. El orden fijo es lo importante:
   * antes se ordenaban por su altura medida, que parecía lo natural, pero están todas en
   * la misma fila y cualquier temblor de un píxel les cambiaba el orden; la escalera se
   * rehacía al revés cada fotograma y se quedaban oscilando unas encima de otras sin
   * llegar a separarse nunca. El nombre de la sección no se mueve: hace de obstáculo.
   */
  private separateLabels(hub: Hub, dt: number): void {
    // Margen holgado: los cúbits respiran en vertical, así que con poco hueco la red va
    // por detrás del movimiento y deja solapes de uno o dos fotogramas.
    const GAP = 10;
    const measure = (s: { label: CSS2DObject; dy: number }) => {
      const r = (s.label.element.firstElementChild as HTMLElement).getBoundingClientRect();
      return { s, left: r.left, right: r.right, top: r.top - s.dy, height: r.height, target: 0 };
    };
    const boxes = hub.subs.filter((s) => s.label.visible).map(measure).filter((b) => b.height > 0);
    // La sección solo estorba mientras se apaga: abierta del todo su etiqueta no se ve.
    const fixed =
      hub.label.visible && hub.active < 0.5 ? [measure(hub)].filter((b) => b.height > 0) : [];

    for (let k = 0; k < boxes.length; k++) {
      const b = boxes[k];
      for (const a of k > 0 ? [...boxes.slice(0, k), ...fixed] : fixed) {
        if (a.right < b.left || a.left > b.right) continue; // no se cruzan de ancho
        const aTop = a.top + a.target;
        const bTop = b.top + b.target;
        if (bTop >= aTop + a.height + GAP || aTop >= bTop + b.height + GAP) continue; // ya se libran
        b.target = aTop - GAP - b.height - b.top;
      }
    }

    for (const b of boxes) {
      b.s.dy = easeTo(b.s.dy, b.target, dt, 18);
      (b.s.label.element.firstElementChild as HTMLElement).style.setProperty('--dy', `${b.s.dy.toFixed(1)}px`);
    }
    hub.dy = 0;
  }

  private bootOf(i: number): number {
    const t = this.time - BOOT_LEAD - this.qubits[i].bootDelay * BOOT_SWEEP;
    return THREE.MathUtils.smoothstep(t / BOOT_RISE, 0, 1);
  }

  private hoverIndex(): number {
    const h = this.hovered;
    if (!h || h.kind === 'item') return -1;
    if (h.kind === 'qubit') return h.index;
    return this.hubs.find((x) => x.item.id === h.itemId)?.subs.find((s) => s.sub.id === h.subId)?.index ?? -1;
  }

  private toggleHover(hit: HitInfo | null, on: boolean): void {
    if (!hit || hit.kind === 'qubit') return;
    const hub = this.hubs.find((x) => x.item.id === hit.itemId);
    if (!hub) return;
    if (hit.kind === 'item') hub.label.element.classList.toggle('hover', on);
    else hub.subs.find((s) => s.sub.id === hit.subId)?.label.element.classList.toggle('hover', on);
  }
}

/** Suavizado con rebote: el cúbit se pasa un poco de su sitio y vuelve. */
function backOut(t: number): number {
  const u = t - 1;
  return 1 + 2.2 * u * u * u + 1.2 * u * u;
}

function sameHit(a: HitInfo | null, b: HitInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'qubit' && b.kind === 'qubit') return a.index === b.index;
  if (a.kind === 'sub' && b.kind === 'sub') return a.itemId === b.itemId && a.subId === b.subId;
  if (a.kind === 'item' && b.kind === 'item') return a.itemId === b.itemId;
  return false;
}

function toRgba(c: THREE.Color): string {
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},1)`;
}
