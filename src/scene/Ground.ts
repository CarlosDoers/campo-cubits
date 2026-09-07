import * as THREE from 'three';
import { PALETTE } from '../palette';

const DIE_MARGIN = 1.3; // sustrato que sobresale de la retícula
const DIE_THICK = 0.34;
const DIE_TOP = 0.06; // cara superior del sustrato
const DIE_CORNER = 0.9;
const RIM_DRAW_SECONDS = 0.9; // lo que tarda el borde en trazarse al arrancar

/**
 * El sustrato del chip, y nada más.
 *
 * Antes esto llevaba también un suelo espejo, una rejilla infinita y una cúpula con
 * degradado: los tres clichés de "escena 3D" más reconocibles, y los tres compitiendo
 * con lo único que importa. El fondo ahora es plano y la pastilla se sostiene sola.
 */
export class Ground {
  readonly group = new THREE.Group();

  private readonly rimMat: THREE.LineBasicMaterial;
  private readonly rim: THREE.Line;
  private readonly rimPoints: number;
  private t = 0;

  constructor(chipWidth: number, chipDepth: number) {
    const w = chipWidth / 2 + DIE_MARGIN;
    const d = chipDepth / 2 + DIE_MARGIN;
    const r = DIE_CORNER;

    const shape = new THREE.Shape();
    shape.moveTo(-w + r, -d);
    shape.lineTo(w - r, -d);
    shape.quadraticCurveTo(w, -d, w, -d + r);
    shape.lineTo(w, d - r);
    shape.quadraticCurveTo(w, d, w - r, d);
    shape.lineTo(-w + r, d);
    shape.quadraticCurveTo(-w, d, -w, d - r);
    shape.lineTo(-w, -d + r);
    shape.quadraticCurveTo(-w, -d, -w + r, -d);

    const geo = new THREE.ExtrudeGeometry(shape, { depth: DIE_THICK, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2); // la silueta pasa del plano XY al XZ
    geo.translate(0, DIE_TOP - DIE_THICK, 0);
    const die = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x080c12 }));

    // Borde superior: la silueta de la pieza. Va como `Line` abierta con el primer punto
    // repetido al final, y no como `LineLoop`, para poder trazarlo poco a poco con
    // `setDrawRange` en el arranque —un bucle cerrado a medias se cerraría con una
    // cuerda recta y se vería el truco—.
    const pts = shape.getPoints(96).map((p) => new THREE.Vector3(p.x, DIE_TOP + 0.004, p.y));
    pts.push(pts[0].clone());
    this.rimMat = new THREE.LineBasicMaterial({ color: PALETTE.line, transparent: true, opacity: 1 });
    const rimGeo = new THREE.BufferGeometry().setFromPoints(pts);
    rimGeo.setDrawRange(0, 0);
    this.rim = new THREE.Line(rimGeo, this.rimMat);
    this.rimPoints = pts.length;

    this.group.add(die, this.rim);
  }

  /** Traza el borde del sustrato al arrancar: es lo primero que aparece. */
  update(dt: number): void {
    if (this.t >= RIM_DRAW_SECONDS) return;
    this.t += dt;
    const p = Math.min(1, this.t / RIM_DRAW_SECONDS);
    this.rim.geometry.setDrawRange(0, Math.ceil(p * this.rimPoints));
  }

  /** Atenúa el borde al enfocar un territorio (`focus` de 0 a 1). */
  setFocus(focus: number): void {
    this.rimMat.opacity = 1 - 0.6 * focus;
  }
}
