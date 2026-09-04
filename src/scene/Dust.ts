import * as THREE from 'three';
import { radialTexture } from './helpers';

/** Motas de polvo luminoso que ascienden lentamente sobre el campo. */
export class Dust {
  readonly points: THREE.Points;
  private readonly box = new THREE.Vector3(40, 9, 36);
  private readonly speeds: Float32Array;

  constructor(count = 700) {
    const pos = new Float32Array(count * 3);
    this.speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * this.box.x;
      pos[i * 3 + 1] = Math.random() * this.box.y;
      pos[i * 3 + 2] = (Math.random() - 0.5) * this.box.z;
      this.speeds[i] = 0.08 + Math.random() * 0.18;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0x9fe9ff,
        map: radialTexture([
          [0, 'rgba(255,255,255,1)'],
          [0.4, 'rgba(255,255,255,0.35)'],
          [1, 'rgba(255,255,255,0)'],
        ]),
        size: 0.09,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
  }

  update(dt: number, focus: number): void {
    const arr = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = arr.array as Float32Array;
    for (let i = 0; i < this.speeds.length; i++) {
      a[i * 3 + 1] += this.speeds[i] * dt;
      a[i * 3] += Math.sin(a[i * 3 + 1] * 1.3 + i) * dt * 0.05;
      if (a[i * 3 + 1] > this.box.y) a[i * 3 + 1] = 0;
    }
    arr.needsUpdate = true;
    (this.points.material as THREE.PointsMaterial).opacity = 0.5 * (1 - 0.7 * focus);
  }
}
