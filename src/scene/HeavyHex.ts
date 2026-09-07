/**
 * Retícula heavy-hex de 156 cúbits, como la del IBM Quantum Heron r2:
 * 8 filas de 16 cúbits unidas por 28 cúbits "puente" (4 entre cada par de filas),
 * alternando columnas 0·4·8·12 y 2·6·10·14. La numeración sigue el orden de IBM:
 * fila, puentes, fila, puentes…
 */
export interface QubitNode {
  index: number;
  x: number;
  z: number;
  row: number;
  col: number;
  bridge: boolean;
}

export interface Topology {
  nodes: QubitNode[];
  edges: Array<[number, number]>;
  neighbours: number[][];
  /** Anchura y profundidad del chip en unidades de escena. */
  width: number;
  depth: number;
}

const ROWS = 8;
export const COLS = 16;
export const COL_PITCH = 1;
const ROW_PITCH = 2;
export const BRIDGE_COLS = [
  [0, 4, 8, 12],
  [2, 6, 10, 14],
];
const BLOCK = COLS + BRIDGE_COLS[0].length; // cúbits por fila + sus puentes

export function heavyHex(): Topology {
  const nodes: QubitNode[] = [];
  const edges: Array<[number, number]> = [];
  const x0 = -((COLS - 1) * COL_PITCH) / 2;
  const z0 = -((ROWS - 1) * ROW_PITCH) / 2;

  for (let r = 0; r < ROWS; r++) {
    const start = r * BLOCK;
    for (let c = 0; c < COLS; c++) {
      nodes.push({ index: nodes.length, x: x0 + c * COL_PITCH, z: z0 + r * ROW_PITCH, row: r, col: c, bridge: false });
    }
    for (let c = 0; c < COLS - 1; c++) edges.push([start + c, start + c + 1]);

    if (r < ROWS - 1) {
      for (const c of BRIDGE_COLS[r % 2]) {
        const idx = nodes.length;
        nodes.push({ index: idx, x: x0 + c * COL_PITCH, z: z0 + (r + 0.5) * ROW_PITCH, row: r, col: c, bridge: true });
        edges.push([start + c, idx]);
        edges.push([idx, (r + 1) * BLOCK + c]);
      }
    }
  }

  const neighbours: number[][] = nodes.map(() => []);
  for (const [a, b] of edges) {
    neighbours[a].push(b);
    neighbours[b].push(a);
  }

  return { nodes, edges, neighbours, width: (COLS - 1) * COL_PITCH, depth: (ROWS - 1) * ROW_PITCH };
}

/**
 * ¿Hay un cúbit puente entre la fila `r` y la `r + 1` en la columna `c`? Son las líneas
 * que interconectan las filas, y las que usa el menú para colgar un subnivel de su
 * sección: la sección va en una fila y sus hijas en la de arriba, unidas por el puente.
 */
export function hasBridge(r: number, c: number): boolean {
  return r >= 0 && r < ROWS - 1 && BRIDGE_COLS[r % 2].includes(c);
}

/** Distancia en saltos desde `source` a cada cúbit (-1 si no es alcanzable). */
export function bfsDistances(topology: Topology, source: number): Int16Array {
  const dist = new Int16Array(topology.nodes.length).fill(-1);
  const queue = [source];
  dist[source] = 0;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    for (const j of topology.neighbours[i]) {
      if (dist[j] === -1) {
        dist[j] = dist[i] + 1;
        queue.push(j);
      }
    }
  }
  return dist;
}

/** Cúbits en orden de cercanía (saltos) a `source`, sin incluirlo. */
export function bfsOrder(topology: Topology, source: number): number[] {
  const dist = bfsDistances(topology, source);
  return [...dist.keys()].filter((i) => i !== source && dist[i] >= 0).sort((a, b) => dist[a] - dist[b]);
}
