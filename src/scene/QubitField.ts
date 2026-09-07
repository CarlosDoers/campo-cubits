import * as THREE from 'three';
import type { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { SubItem, Territory } from '../menu';
import { bfsOrder, heavyHex, type QubitNode, type Topology } from './HeavyHex';
import { Circuit } from './Circuit';
import { easeTo, glowSprite, makeLabel, radialTexture } from './helpers';

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
const IDLE = 0.42; // brillo de un cúbit en reposo: deja sitio a que la puerta destaque
const BASE_Y = 0.55; // altura a la que flota la retícula sobre el sustrato
const BREATH = 0.045; // respiración vertical; no hay deriva horizontal, la retícula es exacta
/**
 * Reparto de las subsecciones al abrir un territorio. Se calcula **relativo a la
 * cámara**, no en coordenadas del chip: si no, el reparto depende del ángulo desde el
 * que abras el territorio y unas veces sale bien y otras se amontonan.
 *
 * - `u` reparte de lado a lado, con una pizca de desorden.
 * - la altura alterna alta y baja: es lo que impide que las etiquetas se pisen, porque
 *   de ancho no hay sitio para ponerlas seguidas.
 * - `v` mete algo de profundidad, para que no parezca una fila recortada.
 */
const SUB_SPREAD = 2.9; // reparto lateral respecto al tótem
const SUB_JITTER = 0.34; // desorden lateral
const SUB_DEPTH = 0.6; // profundidad (con la cámara rasante, mueve mucho en pantalla)
const SUB_LOW = 1.2; // alturas alternas
const SUB_HIGH = 3.4;
const SUB_HEIGHT_JITTER = 0.3;
const HUB_LABEL_Y = 2.05; // altura del nombre del territorio en reposo...
const HUB_LABEL_OPEN_Y = 5; // ...y abierto, coronando el grupo de subsecciones
const HUB_BEAM_H = 1.8; // altura del haz en reposo
const QUBIT_SIZE = 0.085;
const BRIDGE_SIZE = 0.055; // los cúbits puente son de grado 2: más pequeños, como en los diagramas de IBM
const HUB_SIZE = 0.15;
const SUB_SIZE = 0.115;
const COUPLER_W = 0.028; // grosor de la barra de acoplador
const BASE = new THREE.Color(0x8fe8ff);
const COUPLER = new THREE.Color(0x22637a);
const GATE = new THREE.Color(0xffffff);
const READ_ONE = new THREE.Color(0xff9be0); // cúbit medido a |1⟩
const READ_ZERO = new THREE.Color(0x3b6cff); // cúbit medido a |0⟩

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
  index: number;
  hit: THREE.Mesh;
  label: CSS2DObject;
  /** Sitio que ocupa al elevarse, en el marco de la cámara: lateral, profundidad y altura. */
  u: number;
  v: number;
  height: number;
  /** Empujón vertical en pantalla para no pisar a otra etiqueta. */
  dy: number;
}

interface Hub {
  item: Territory;
  index: number;
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

  /** Posición en el sustrato del cúbit-territorio (para el vuelo de cámara). */
  hubPosition(id: string): THREE.Vector3 | null {
    const hub = this.hubs.find((h) => h.item.id === id);
    return hub ? new THREE.Vector3(this.qubits[hub.index].node.x, 0, this.qubits[hub.index].node.z) : null;
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
   * `camAzimuth` orienta el reparto de las subsecciones hacia la cámara.
   */
  update(dt: number, focus: number, camAzimuth: number): void {
    this.time += dt;
    const t = this.time;
    const rest = 1 - (1 - REST_DIM) * focus;
    const hoverIndex = this.hoverIndex();

    if (!this.booting) this.circuit.update(dt);

    // Marco horizontal de la cámara: `right` va hacia la derecha de la pantalla y
    // `away` se aleja del espectador.
    const rx = Math.cos(camAzimuth);
    const rz = -Math.sin(camAzimuth);
    const ax = -Math.sin(camAzimuth);
    const az = -Math.cos(camAzimuth);

    // --- estado por defecto de cada cúbit; los territorios lo sobrescriben ---
    for (const q of this.qubits) {
      q.lift = 0;
      q.sx = 0;
      q.sz = 0;
      q.targetScale = q.size;
      q.targetColor.copy(BASE).multiplyScalar(IDLE * rest);
    }

    // --- territorios y subsecciones: objetivos ---
    for (const hub of this.hubs) {
      const isSel = hub.item.id === this.selectedId;
      const isHover = this.hovered?.kind === 'item' && this.hovered.itemId === hub.item.id;
      const k = isSel ? 1 : rest;
      hub.scale = easeTo(hub.scale, isSel ? 1.3 : isHover ? 1.2 : 1, dt, 8);
      hub.active = easeTo(hub.active, isSel ? 1 : 0, dt, 4);

      const q = this.qubits[hub.index];
      q.targetScale = HUB_SIZE * hub.scale;
      q.targetColor.copy(hub.color).multiplyScalar(k);

      const boot = this.bootOf(hub.index);
      hub.group.visible = boot > 0.01;
      hub.group.scale.setScalar(boot);
      hub.ringMat.opacity = 0.7 * k;
      hub.beamMat.opacity = 0.22 * k * (1 - hub.active); // abierto no queda ninguna línea
      hub.glow.material.opacity = 0.5 * k * (isSel || isHover ? 1.25 : 1);
      hub.label.visible = boot > 0.5;
      // Abierto, el nombre sube a coronar el grupo: si se queda abajo choca con las
      // subsecciones, que ahora flotan repartidas alrededor.
      hub.label.position.y = HUB_LABEL_Y + (HUB_LABEL_OPEN_Y - HUB_LABEL_Y) * hub.active;

      // Las subsecciones se despegan del campo y quedan flotando repartidas alrededor
      // del tótem, cada una a su altura. Sin líneas: las une el color y la cercanía.
      for (const s of hub.subs) {
        const sq = this.qubits[s.index];
        sq.lift = s.height * hub.active;
        sq.sx = (q.node.x + rx * s.u + ax * s.v - sq.node.x) * hub.active;
        sq.sz = (q.node.z + rz * s.u + az * s.v - sq.node.z) * hub.active;
        sq.targetScale = sq.size + (SUB_SIZE - sq.size) * hub.active;
        sq.targetColor.copy(BASE).multiplyScalar(IDLE * rest).lerp(hub.color, hub.active);
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
      this.tmpColor.copy(q.color).multiplyScalar(1 + 0.85 * gate).lerp(GATE, gate * 0.5);
      if (read > 0) this.tmpColor.lerp(this.circuit.bits[i] === 1 ? READ_ONE : READ_ZERO, read * 0.9 * rest);
      this.mesh.setColorAt(i, this.tmpColor);

      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.hitMesh.setMatrixAt(i, this.dummy.matrix);

      haloPos.setXYZ(i, q.pos.x, q.pos.y, q.pos.z);
      this.tmpColor.multiplyScalar((0.22 + 0.65 * gate + 0.5 * read * rest + 0.4 * q.hover) * boot);
      haloCol.setXYZ(i, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.hitMesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    haloPos.needsUpdate = true;
    haloCol.needsUpdate = true;

    // --- acopladores: geometría fija, solo cambia el color al ejecutarse una CZ ---
    this.topology.edges.forEach(([a, b], e) => {
      const boot = Math.min(this.bootOf(a), this.bootOf(b));
      this.tmpColor.copy(COUPLER).multiplyScalar(rest * boot);
      this.couplers.setColorAt(e, this.tmpColor);
    });
    if (this.couplers.instanceColor) this.couplers.instanceColor.needsUpdate = true;

    // --- territorios y subsecciones: colocación final ---
    for (const hub of this.hubs) {
      const isSel = hub.item.id === this.selectedId;
      const hq = this.qubits[hub.index];
      hub.group.position.copy(hq.pos);
      const a = hub.active;

      for (const s of hub.subs) {
        const q = this.qubits[s.index];
        s.hit.position.copy(q.pos);
        s.hit.visible = isSel;
        s.label.position.set(q.pos.x, q.pos.y + 0.32, q.pos.z);
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
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }),
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

  private buildHubs(items: Territory[]): void {
    const used = new Set<number>();
    const candidates = this.topology.nodes.filter((n) => !n.bridge);

    // Un cúbit por territorio, repartidos en elipse sobre el chip.
    const hubIndex = items.map((_, k) => {
      const ang = -Math.PI / 2 - 0.25 + (k / items.length) * Math.PI * 2;
      const tx = Math.cos(ang) * this.topology.width * 0.36;
      const tz = Math.sin(ang) * this.topology.depth * 0.36;
      let best = -1;
      let bestD = Infinity;
      for (const n of candidates) {
        if (used.has(n.index)) continue;
        const d = (n.x - tx) ** 2 + (n.z - tz) ** 2;
        if (d < bestD) {
          bestD = d;
          best = n.index;
        }
      }
      used.add(best);
      return best;
    });

    items.forEach((item, k) => {
      const index = hubIndex[k];
      const color = new THREE.Color(item.color);
      const q = this.qubits[index];
      q.damp = 0.3;
      q.scale = q.targetScale = HUB_SIZE;
      q.color.copy(color);
      q.targetColor.copy(color);

      const group = new THREE.Group();
      group.position.copy(q.pos);
      group.visible = false;

      const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.01, 6, 48), ringMat);
      ring.rotation.x = Math.PI / 2;
      const beamMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.05, HUB_BEAM_H, 8, 1, true), beamMat);
      beam.position.y = HUB_BEAM_H / 2;
      const glow = glowSprite(toRgba(color), 1.1, 0.5);
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 8), invisible());
      hit.userData = { kind: 'item', itemId: item.id } satisfies HitInfo;
      const label = makeLabel(item.label, 'hub-label', item.color);
      label.position.y = HUB_LABEL_Y;
      group.add(ring, beam, glow, hit, label);
      this.group.add(group);

      // Subsecciones: los cúbits acoplados al del territorio (saltos por los acopladores).
      const subs = bfsOrder(this.topology, index)
        .filter((i) => !used.has(i))
        .slice(0, item.items.length)
        .map((i, j) => {
          used.add(i);
          const sub = item.items[j];
          const shit = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8), invisible());
          shit.visible = false;
          shit.userData = { kind: 'sub', itemId: item.id, subId: sub.id } satisfies HitInfo;
          const slabel = makeLabel(sub.label, 'sub-label', item.color);
          slabel.visible = false;
          this.group.add(shit, slabel);

          // Desorden estable: el mismo territorio se abre siempre igual, pero cada uno
          // se reparte distinto.
          const wob = (n: number) => (((Math.sin(n) * 43758.5453) % 1) + 1) % 1 - 0.5;
          const total = item.items.length;
          const lane = total > 1 ? ((j + 0.5) / total) * 2 - 1 : 0;
          return {
            sub,
            index: i,
            hit: shit,
            label: slabel,
            u: lane * SUB_SPREAD + wob(j * 12.9898 + k) * SUB_JITTER * 2,
            v: wob(j * 78.233 + k * 3.7) * SUB_DEPTH * 2,
            height: (j % 2 === 0 ? SUB_LOW : SUB_HIGH) + wob(j * 39.425 + k * 7.1) * SUB_HEIGHT_JITTER * 2,
            dy: 0,
          };
        });

      this.hubs.push({ item, index, color, group, ringMat, beamMat, glow, hit, label, dy: 0, scale: 1, active: 0, subs });
    });
  }

  // ---------- utilidades ----------

  /**
   * Red de seguridad: el reparto está pensado para que las etiquetas no se toquen, pero
   * depende del texto y del ángulo de cámara, así que si dos llegan a pisarse se empuja
   * la de arriba lo justo. El desplazamiento es pequeño y suavizado: no se nota, pero
   * garantiza que siempre se lean, cambie el contenido que cambie.
   */
  private separateLabels(hub: Hub, dt: number): void {
    const GAP = 6;
    const movable: Array<{ label: CSS2DObject; dy: number }> = [...hub.subs, hub];
    const boxes = movable
      .filter((s) => s.label.visible)
      .map((s) => {
        const r = (s.label.element.firstElementChild as HTMLElement).getBoundingClientRect();
        return { s, left: r.left, right: r.right, top: r.top - s.dy, height: r.height, target: 0 };
      })
      .filter((b) => b.height > 0)
      .sort((a, b) => a.top - b.top);

    // De abajo arriba: cada etiqueta empuja a las que tenga encima y se le monten.
    for (let k = boxes.length - 1; k >= 0; k--) {
      const lower = boxes[k];
      const lowerTop = lower.top + lower.target;
      for (let m = k - 1; m >= 0; m--) {
        const upper = boxes[m];
        if (upper.right < lower.left || upper.left > lower.right) continue;
        const upperBottom = upper.top + upper.target + upper.height;
        if (upperBottom + GAP > lowerTop) upper.target = lowerTop - GAP - upper.height - upper.top;
      }
    }

    for (const s of movable) {
      const box = boxes.find((b) => b.s === s);
      s.dy = easeTo(s.dy, box ? box.target : 0, dt, 12);
      (s.label.element.firstElementChild as HTMLElement).style.setProperty('--dy', `${s.dy.toFixed(1)}px`);
    }
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
