import type { Topology } from './HeavyHex';

/**
 * Un circuito cuántico ejecutándose sobre el chip. No simula nada: marca el ritmo de
 * lo que pasa en un Heron cuando corre un trabajo.
 *
 * - El circuito avanza por **capas**, que el HUD va contando. Las capas **no se
 *   pintan**: encender sus puertas hacía parpadear el chip entero una y otra vez, y
 *   en un menú eso cansa y compite con la navegación. El circuito se cuenta, no se
 *   destella.
 * - El acontecimiento visible es la **medida**: un frente de lectura cruza el chip y
 *   cada cúbit colapsa a 0 o a 1.
 * - Después, reposo, y vuelve a empezar con un circuito nuevo.
 */

export type Phase = 'gates' | 'measure' | 'idle';

const LAYER_SECONDS = 0.52; // duración de cada capa del circuito
const MEASURE_SECONDS = 2.6; // barrido de lectura de lado a lado
const MEASURE_WIDTH = 0.16; // anchura del frente de lectura (fracción del chip)
const PULSE_DECAY = 2.6; // caída del destello al pasar el frente de lectura
const IDLE_SECONDS = 2.4; // reposo entre un circuito y el siguiente
const DEPTH_MIN = 8;
const DEPTH_MAX = 12;
const LABELS = ['SX', 'CZ', 'RZ', 'CZ', 'X', 'CZ'];

export class Circuit {
  /** Resultado de la última medida: -1 sin medir, 0 o 1 medido. */
  readonly bits: Int8Array;
  /** Cuánto se ha leído ya cada cúbit, 0..1: tiñe el cúbit con su valor. */
  readonly readout: Float32Array;
  /** Destello breve al pasarle por encima el frente de lectura. */
  readonly pulse: Float32Array;

  phase: Phase = 'gates';
  /** Capa actual, 1..depth. */
  layer = 1;
  depth = 0;
  label = LABELS[0];

  private t = 0;
  private readonly x0: number;
  private readonly span: number;

  constructor(private readonly topology: Topology) {
    const n = topology.nodes.length;
    this.bits = new Int8Array(n).fill(-1);
    this.readout = new Float32Array(n);
    this.pulse = new Float32Array(n);

    const xs = topology.nodes.map((q) => q.x);
    this.x0 = Math.min(...xs);
    this.span = Math.max(...xs) - this.x0 || 1;

    this.compile();
  }

  /** Texto para el HUD: qué está haciendo el chip ahora mismo. */
  get status(): string {
    if (this.phase === 'measure') return 'Medida · lectura de los 156 cúbits';
    if (this.phase === 'idle') return 'Preparando el siguiente circuito';
    return `Capa ${this.layer}/${this.depth} · ${this.label}`;
  }

  update(dt: number): void {
    this.t += dt;

    const k = Math.exp(-dt * PULSE_DECAY);
    for (let i = 0; i < this.pulse.length; i++) {
      if (this.pulse[i] > 0) this.pulse[i] = this.pulse[i] < 1e-3 ? 0 : this.pulse[i] * k;
    }

    if (this.phase === 'gates') {
      const index = Math.floor(this.t / LAYER_SECONDS);
      if (index >= this.depth) {
        this.phase = 'measure';
        this.t = 0;
        this.bits.fill(-1);
        this.readout.fill(0);
        return;
      }
      this.layer = index + 1;
      this.label = LABELS[index % LABELS.length];
      return;
    }

    if (this.phase === 'measure') {
      // Frente de lectura que cruza el chip de izquierda a derecha.
      const front = (this.t / MEASURE_SECONDS) * (1 + MEASURE_WIDTH * 2) - MEASURE_WIDTH;
      this.topology.nodes.forEach((node, i) => {
        const u = (node.x - this.x0) / this.span;
        const d = (front - u) / MEASURE_WIDTH;
        if (d < 0) return;
        if (this.bits[i] < 0) this.bits[i] = Math.random() < 0.5 ? 0 : 1;
        this.readout[i] = d < 1 ? d : 1;
        if (d < 1) this.pulse[i] = Math.max(this.pulse[i], 1 - d);
      });
      if (this.t >= MEASURE_SECONDS) {
        this.phase = 'idle';
        this.t = 0;
      }
      return;
    }

    // Reposo: el patrón medido se queda a la vista y se desvanece de forma lineal.
    const fade = Math.max(0, 1 - this.t / IDLE_SECONDS);
    for (let i = 0; i < this.readout.length; i++) {
      if (this.readout[i] > fade) this.readout[i] = fade;
    }
    if (this.t >= IDLE_SECONDS) {
      this.bits.fill(-1);
      this.readout.fill(0);
      this.compile();
      this.phase = 'gates';
      // Se entra ya en la capa 1: si no, el HUD enseña "Capa 0/N" durante un fotograma.
      this.layer = 1;
      this.label = LABELS[0];
      this.t = 0;
    }
  }

  private compile(): void {
    this.depth = DEPTH_MIN + Math.floor(Math.random() * (DEPTH_MAX - DEPTH_MIN + 1));
  }
}
