import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

/** Geometría de puntos distribuidos sobre una circunferencia. */
export function circlePoints(radius: number, count: number, plane: 'xz' | 'xy' = 'xz'): THREE.BufferGeometry {
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const c = Math.cos(a) * radius;
    const s = Math.sin(a) * radius;
    arr[i * 3] = c;
    arr[i * 3 + 1] = plane === 'xy' ? s : 0;
    arr[i * 3 + 2] = plane === 'xz' ? s : 0;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Textura con degradado radial (para halos y sprites de luz). */
export function radialTexture(stops: Array<[number, string]>, size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) g.addColorStop(offset, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Sprite luminoso aditivo. */
export function glowSprite(color: string, scale: number, opacity = 1): THREE.Sprite {
  const map = radialTexture([
    [0, color],
    [0.35, color.replace(/[\d.]+\)$/, '0.35)')],
    [1, 'rgba(0,0,0,0)'],
  ]);
  const mat = new THREE.SpriteMaterial({
    map,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(scale);
  return s;
}

/** Etiqueta HTML anclada a la escena. El texto va dentro de un <span> para poder animarlo. */
export function makeLabel(text: string, className: string, color?: string): CSS2DObject {
  const el = document.createElement('div');
  el.className = className;
  if (color) el.style.setProperty('--c', color);
  const span = document.createElement('span');
  span.textContent = text;
  el.appendChild(span);
  return new CSS2DObject(el);
}

/** Material de borde (Fresnel) para el halo de la esfera. */
export function fresnelMaterial(color: THREE.ColorRepresentation, power = 3, intensity = 1.2): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uPower: { value: power },
      uIntensity: { value: intensity },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uPower;
      uniform float uIntensity;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float f = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), uPower);
        gl_FragColor = vec4(uColor * f * uIntensity, f);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

export const easeTo = (current: number, target: number, dt: number, speed: number): number =>
  current + (target - current) * Math.min(1, dt * speed);
