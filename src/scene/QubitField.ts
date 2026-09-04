import * as THREE from 'three';
import type { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { SubItem, Territory } from '../menu';
import { bfsDistances, bfsOrder, heavyHex, type QubitNode, type Topology } from './HeavyHex';
import { easeTo, glowSprite, makeLabel, radialTexture } from './helpers';

export type HitInfo =
  | { kind: 'item'; itemId: string }
  | { kind: 'sub'; itemId: string; subId: string }
  | { kind: 'qubit'; index: number };

const BOOT_RATE = 62; // cúbits por segundo durante el arranque
const REST_DIM = 0.14; // intensidad que conserva lo no enfocado
const BASE_Y = 0.6; // altura a la que flota el campo sobre el espejo
const JITTER = 0.1; // desalineación aleatoria de cada cúbit respecto a la retícula
const DRIFT = 0.05; // deriva lenta en horizontal
const SUB_LIFT = 1.7; // altura a la que suben las subsecciones al seleccionar
const SUB_ARC_STEP = 0.7; // separación angular entre subsecciones (rad)
const SUB_ARC_MAX = 2.4; // apertura máxima del arco (rad)
const SUB_RADIUS = 1.6; // radio base del arco; crece con el número de subsecciones
const WAVE_EVERY = 3.6; // segundos entre ondas de excitación
const WAVE_HOP = 0.1; // segundos por salto de acoplador
const WAVE_DECAY = 2.2;
const WAVE_LIFE = 8;
const QUBIT_SIZE = 0.08;
const HUB_SIZE = 0.15;
const SUB_SIZE = 0.11;
const BASE = new THREE.Color(0x9df3ff);
const COUPLER = new THREE.Color(0x5fd4ee);
const WHITE = new THREE.Color(0xffffff);
const UP = new THREE.Vector3(0, 1, 0);

interface Qubit {
  node: QubitNode;
  seed: number;
  ox: number;
  oz: number;
  pos: THREE.Vector3;
  lift: number;
  sx: number;
  sz: number;
  hover: number;
  scale: number;
  targetScale: number;
  color: THREE.Color;
  targetColor: THREE.Color;
  excite: number;
}

interface Wave {
  t0: number;
  dist: Int16Array;
}

interface SubNode {
  sub: SubItem;
  index: number;
  hit: THREE.Mesh;
  pillar: THREE.Mesh;
  pillarMat: THREE.MeshBasicMaterial;
  link: THREE.Mesh;
  label: CSS2DObject;
  /** Desplazamiento vertical en pantalla (px) para no solapar otros chips. */
  dy: number;
}

interface Hub {
  item: Territory;
  index: number;
  color: THREE.Color;
  group: THREE.Group;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  beam: THREE.Mesh;
  beamMat: THREE.MeshBasicMaterial;
  glow: THREE.Sprite;
  hit: THREE.Mesh;
  label: CSS2DObject;
  scale: number;
  active: number;
  subs: SubNode[];
}

const invisible = () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);

/**
 * El campo: 156 cúbits flotando en su retícula heavy-hex, unidos por hilos de luz,
 * con ondas de excitación, territorios (cúbits-tótem) y subsecciones que se elevan.
 */
export class QubitField {
  readonly group = new THREE.Group();
  readonly topology: Topology;

  private readonly qubits: Qubit[] = [];
  private readonly hubs: Hub[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly hitMesh: THREE.InstancedMesh;
  private readonly halos: THREE.Points;
  private readonly threads: THREE.LineSegments;
  private readonly tooltip: CSS2DObject;
  private waves: Wave[] = [];
  private nextWave = 3.6;
  private hovered: HitInfo | null = null;
  private selectedId: string | null = null;
  private time = 0;
  private readonly dummy = new THREE.Object3D();
  private readonly tmpColor = new THREE.Color();

  constructor(items: Territory[], expectedCount: number) {
    this.topology = heavyHex();
    const n = this.topology.nodes.length;
    if (n !== expectedCount) throw new Error(`La retícula tiene ${n} cúbits, se esperaban ${expectedCount}`);

    for (const node of this.topology.nodes) {
      this.qubits.push({
        node,
        seed: Math.random() * Math.PI * 2,
        ox: (Math.random() - 0.5) * 2 * JITTER,
        oz: (Math.random() - 0.5) * 2 * JITTER,
        pos: new THREE.Vector3(node.x, BASE_Y, node.z),
        lift: 0, sx: 0, sz: 0, hover: 0,
        scale: QUBIT_SIZE, targetScale: QUBIT_SIZE,
        color: BASE.clone(), targetColor: BASE.clone(), excite: 0,
      });
    }

    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    this.hitMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.24, 6, 5), invisible(), n);
    for (let i = 0; i < n; i++) this.mesh.setColorAt(i, BASE);

    // Halos suaves alrededor de cada cúbit (un solo objeto Points).
    const haloGeo = new THREE.BufferGeometry();
    haloGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    haloGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.halos = new THREE.Points(
      haloGeo,
      new THREE.PointsMaterial({
        size: 0.75,
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

    // Hilos finos entre cúbits acoplados; el color por vértice lleva la onda.
    const m = this.topology.edges.length;
    const threadGeo = new THREE.BufferGeometry();
    threadGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m * 6), 3));
    threadGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(m * 6), 3));
    this.threads = new THREE.LineSegments(
      threadGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }),
    );

    this.tooltip = makeLabel('', 'qubit-tip');
    this.tooltip.visible = false;

    this.group.add(this.mesh, this.hitMesh, this.halos, this.threads, this.tooltip);
    this.buildHubs(items);
  }

  /** Cúbits ya "encendidos" durante la animación de arranque. */
  get booted(): number {
    return Math.min(this.qubits.length, Math.floor(this.time * BOOT_RATE));
  }

  get selected(): string | null {
    return this.selectedId;
  }

  /** Posición en el suelo del cúbit-territorio (para el vuelo de cámara). */
  hubPosition(id: string): THREE.Vector3 | null {
    const hub = this.hubs.find((h) => h.item.id === id);
    return hub ? new THREE.Vector3(hub.group.position.x, 0, hub.group.position.z) : null;
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
      (this.tooltip.element.firstChild as HTMLElement).textContent = `Q·${String(hit.index).padStart(3, '0')}`;
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

  /** `focus` va de 0 (plano general) a 1 (territorio enfocado: el resto se atenúa). */
  update(dt: number, focus: number): void {
    this.time += dt;
    const t = this.time;
    const rest = 1 - (1 - REST_DIM) * focus;
    const hoverIndex = this.hoverIndex();

    // --- ondas de excitación que recorren los hilos ---
    if (t > this.nextWave) {
      const source = Math.floor(Math.random() * this.qubits.length);
      this.waves.push({ t0: t, dist: bfsDistances(this.topology, source) });
      this.nextWave = t + WAVE_EVERY;
    }
    this.waves = this.waves.filter((w) => t - w.t0 < WAVE_LIFE);

    // --- estado por defecto de cada cúbit; los territorios lo sobrescriben ---
    this.qubits.forEach((q, i) => {
      q.lift = 0;
      q.sx = 0;
      q.sz = 0;
      q.targetScale = QUBIT_SIZE;
      q.targetColor.copy(BASE).multiplyScalar(rest);
      let excite = 0;
      for (const w of this.waves) {
        const d = w.dist[i];
        if (d < 0) continue;
        const u = t - w.t0 - d * WAVE_HOP;
        if (u < 0) continue;
        excite = Math.max(excite, u < 0.1 ? u / 0.1 : Math.exp(-(u - 0.1) * WAVE_DECAY));
      }
      q.excite = excite * rest;
    });

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
      q.excite = 0;

      const boot = this.bootOf(hub.index);
      hub.group.visible = boot > 0.01;
      hub.group.scale.setScalar(boot);
      hub.ringMat.opacity = 0.7 * k;
      hub.beamMat.opacity = 0.22 * k * (isSel ? 1.8 : 1);
      hub.glow.material.opacity = 0.5 * k * (isSel || isHover ? 1.25 : 1);
      hub.label.visible = boot > 0.5;

      // Las subsecciones abandonan su hueco y se despliegan en un arco ordenado detrás
      // del territorio (lejos de la cámara de enfoque), de izquierda a derecha como en el panel.
      const n = hub.subs.length;
      const spread = n > 1 ? Math.min(SUB_ARC_MAX, SUB_ARC_STEP * (n - 1)) : 0;
      const radius = SUB_RADIUS + 0.22 * n;
      hub.subs.forEach((s, j) => {
        const sq = this.qubits[s.index];
        const th = n > 1 ? -spread / 2 + (j / (n - 1)) * spread : 0;
        const tx = q.node.x + Math.sin(th) * radius;
        const tz = q.node.z - Math.cos(th) * radius;
        sq.sx = (tx - sq.node.x) * hub.active;
        sq.sz = (tz - sq.node.z) * hub.active;
        sq.lift = (SUB_LIFT + 0.12 * Math.sin(j * 2.1)) * hub.active;
        sq.targetScale = QUBIT_SIZE + (SUB_SIZE - QUBIT_SIZE) * hub.active;
        sq.targetColor.copy(BASE).multiplyScalar(rest).lerp(hub.color, hub.active);
      });
    }

    // --- posiciones y apariencia de los 156 cúbits ---
    const haloPos = this.halos.geometry.getAttribute('position') as THREE.BufferAttribute;
    const haloCol = this.halos.geometry.getAttribute('color') as THREE.BufferAttribute;
    this.qubits.forEach((q, i) => {
      const boot = this.bootOf(i);
      q.hover = easeTo(q.hover, i === hoverIndex ? 1 : 0, dt, 10);
      q.scale = easeTo(q.scale, q.targetScale * (1 + 0.5 * q.hover), dt, 8);
      q.color.lerp(q.targetColor, Math.min(1, dt * 6));

      // Vaivén irregular: una ola lenta que recorre el campo más un temblor propio.
      const { x, z } = q.node;
      const sway = 0.14 * Math.sin(t * 0.7 + x * 0.45 + z * 0.3) + 0.07 * Math.sin(t * 1.25 + q.seed);
      q.pos.set(
        x + q.ox + q.sx + DRIFT * Math.sin(t * 0.45 + q.seed),
        BASE_Y + sway + q.lift + 0.18 * q.hover - 1.1 * (1 - boot),
        z + q.oz + q.sz + DRIFT * Math.cos(t * 0.38 + q.seed * 1.3),
      );
      const breathe = 1 + 0.1 * Math.sin(t * 1.6 + q.seed);

      this.dummy.position.copy(q.pos);
      this.dummy.scale.setScalar(q.scale * breathe * (1 + 0.3 * q.excite) * boot);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.tmpColor.copy(q.color).lerp(WHITE, q.excite * 0.45));

      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.hitMesh.setMatrixAt(i, this.dummy.matrix);

      haloPos.setXYZ(i, q.pos.x, q.pos.y, q.pos.z);
      this.tmpColor.copy(q.color).multiplyScalar((0.32 + 0.9 * q.excite + 0.4 * q.hover) * boot);
      haloCol.setXYZ(i, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.hitMesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    haloPos.needsUpdate = true;
    haloCol.needsUpdate = true;

    // --- hilos: siguen a los cúbits y se encienden con las ondas ---
    const linePos = this.threads.geometry.getAttribute('position') as THREE.BufferAttribute;
    const lineCol = this.threads.geometry.getAttribute('color') as THREE.BufferAttribute;
    this.topology.edges.forEach(([a, b], e) => {
      const qa = this.qubits[a];
      const qb = this.qubits[b];
      const boot = Math.min(this.bootOf(a), this.bootOf(b));
      linePos.setXYZ(e * 2, qa.pos.x, qa.pos.y, qa.pos.z);
      linePos.setXYZ(e * 2 + 1, qb.pos.x, qb.pos.y, qb.pos.z);
      for (const [k, q] of [qa, qb].entries()) {
        this.tmpColor.copy(COUPLER).multiplyScalar(0.45 * rest * boot).lerp(WHITE, q.excite * 0.7 * boot);
        lineCol.setXYZ(e * 2 + k, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
      }
    });
    linePos.needsUpdate = true;
    lineCol.needsUpdate = true;

    // --- territorios y subsecciones: colocación final ---
    for (const hub of this.hubs) {
      const isSel = hub.item.id === this.selectedId;
      const hq = this.qubits[hub.index];
      hub.group.position.copy(hq.pos);
      hub.ring.position.y = 0.012 - hq.pos.y; // el anillo se queda en el suelo
      hub.beam.position.y = (1.6 - hq.pos.y) / 2; // el haz va del suelo a 1.6 sobre el cúbit
      hub.beam.scale.y = (1.6 + hq.pos.y) / 2.2;
      const a = hub.active;

      for (const s of hub.subs) {
        const q = this.qubits[s.index];
        s.hit.position.copy(q.pos);
        s.hit.visible = isSel;

        const on = a > 0.02;
        s.pillar.visible = on;
        s.link.visible = on;
        if (on) {
          const h = Math.max(0.01, q.pos.y - 0.02);
          s.pillar.position.set(q.pos.x, 0.02 + h / 2, q.pos.z);
          s.pillar.scale.set(0.018 * a, h, 0.018 * a);
          s.pillarMat.opacity = 0.55 * a;
          orientLink(s.link, hq.pos, q.pos, 0.012 * a);
          (s.link.material as THREE.MeshBasicMaterial).opacity = 0.85 * a;
        }
        s.label.position.set(q.pos.x, q.pos.y + 0.36, q.pos.z);
        s.label.visible = isSel && a > 0.6;
      }
      this.separateChips(hub, dt);
    }

    if (this.hovered?.kind === 'qubit') {
      const q = this.qubits[this.hovered.index];
      this.tooltip.position.set(q.pos.x, q.pos.y + 0.32, q.pos.z);
      this.tooltip.visible = true;
    } else {
      this.tooltip.visible = false;
    }
  }

  // ---------- construcción ----------

  private buildHubs(items: Territory[]): void {
    const used = new Set<number>();
    const candidates = this.topology.nodes.filter((n) => !n.bridge);

    // Un cúbit por territorio, repartidos en elipse sobre el campo.
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
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.03, 2.2, 8, 1, true), beamMat);
      const glow = glowSprite(toRgba(color), 1.1, 0.5);
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 8), invisible());
      hit.userData = { kind: 'item', itemId: item.id } satisfies HitInfo;
      const label = makeLabel(item.label, 'hub-label', item.color);
      label.position.y = 1.95;
      group.add(ring, beam, glow, hit, label);
      this.group.add(group);

      // Subsecciones: los cúbits más cercanos (en saltos) que queden libres.
      const subs = bfsOrder(this.topology, index)
        .filter((i) => !used.has(i))
        .slice(0, item.items.length)
        .map((i, j) => {
          used.add(i);
          const sub = item.items[j];
          const shit = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8), invisible());
          shit.visible = false;
          shit.userData = { kind: 'sub', itemId: item.id, subId: sub.id } satisfies HitInfo;
          const pillarMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
          const pillar = new THREE.Mesh(unitCylinder, pillarMat);
          pillar.visible = false;
          const link = new THREE.Mesh(unitCylinder, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 }));
          link.visible = false;
          const slabel = makeLabel(sub.label, 'sub-label', item.color);
          slabel.visible = false;
          this.group.add(shit, pillar, link, slabel);
          return { sub, index: i, hit: shit, pillar, pillarMat, link, label: slabel, dy: 0 };
        });

      this.hubs.push({ item, index, color, group, ring, ringMat, beam, beamMat, glow, hit, label, scale: 1, active: 0, subs });
    });
  }

  // ---------- utilidades ----------

  /** Separa en pantalla los chips de subsección que se solapen, empujando hacia arriba el superior. */
  private separateChips(hub: Hub, dt: number): void {
    const GAP = 8;
    const boxes = hub.subs
      .filter((s) => s.label.visible)
      .map((s) => {
        const r = (s.label.element.firstElementChild as HTMLElement).getBoundingClientRect();
        return { s, left: r.left, right: r.right, top: r.top - s.dy, height: r.height, target: 0 };
      })
      .filter((b) => b.height > 0)
      .sort((a, b) => a.top - b.top);

    // De abajo arriba: cada chip empuja a los que tenga encima y se le monten.
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

    for (const s of hub.subs) {
      const box = boxes.find((b) => b.s === s);
      s.dy = easeTo(s.dy, box ? box.target : 0, dt, 12);
      (s.label.element.firstElementChild as HTMLElement).style.setProperty('--dy', `${s.dy.toFixed(1)}px`);
    }
  }

  private bootOf(i: number): number {
    return THREE.MathUtils.smoothstep(this.time * BOOT_RATE - i, 0, 10);
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

const linkDir = new THREE.Vector3();

/** Coloca un cilindro unitario entre dos puntos con el grosor indicado. */
function orientLink(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, thickness: number): void {
  linkDir.copy(b).sub(a);
  const len = linkDir.length();
  if (len < 1e-5) {
    mesh.visible = false;
    return;
  }
  mesh.position.copy(a).lerp(b, 0.5);
  mesh.scale.set(thickness, len, thickness);
  mesh.quaternion.setFromUnitVectors(UP, linkDir.divideScalar(len));
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
