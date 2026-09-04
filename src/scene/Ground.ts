import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

/** Variante suave del shader del Reflector: reflejo atenuado, que se desvanece con la distancia y respeta la niebla. */
const softMirrorShader = {
  name: 'SoftMirror',
  uniforms: {
    color: { value: null as THREE.Color | null },
    tDiffuse: { value: null as THREE.Texture | null },
    textureMatrix: { value: null as THREE.Matrix4 | null },
    uStrength: { value: 0.3 },
    uFade: { value: 18.0 },
    ...THREE.UniformsLib.fog,
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <common>
    #include <fog_pars_vertex>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    uniform float uFade;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <fog_pars_fragment>
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec4 base = texture2DProj(tDiffuse, vUv);
      float d = length(vWorld.xz);
      float fade = exp(-(d * d) / (uFade * uFade));
      gl_FragColor = vec4(color + base.rgb * uStrength * fade, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
};

const DIE_MARGIN = 1.3; // sustrato que sobresale de la retícula
const DIE_THICK = 0.34;
const DIE_TOP = 0.06; // cara superior del sustrato
const DIE_CORNER = 0.9;

/** Suelo de cristal oscuro, rejilla tenue, cúpula y el **sustrato del chip**. */
export class Ground {
  readonly group = new THREE.Group();

  private readonly gridMat: THREE.ShaderMaterial;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly rimMat: THREE.LineBasicMaterial;

  constructor(chipWidth: number, chipDepth: number, size = 240) {
    const mirror = new Reflector(new THREE.PlaneGeometry(size, size), {
      clipBias: 0.003,
      textureWidth: 1024,
      textureHeight: 1024,
      color: 0x04060b,
      shader: softMirrorShader,
    });
    (mirror.material as THREE.ShaderMaterial).fog = true;
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.y = -0.03;

    this.gridMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0x2c5d70) },
        uCell: { value: 1.0 },
        uFade: { value: 16.0 },
        uDim: { value: 1.0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uCell;
        uniform float uFade;
        uniform float uDim;
        varying vec3 vWorld;
        void main() {
          vec2 p = vWorld.xz / uCell;
          vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
          float line = 1.0 - min(min(g.x, g.y), 1.0);
          float d = length(vWorld.xz);
          float fade = exp(-(d * d) / (uFade * uFade));
          gl_FragColor = vec4(uColor, line * fade * 0.22 * uDim);
        }`,
      transparent: true,
      depthWrite: false,
    });
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.gridMat);
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = -0.02;

    // Cúpula con degradado: horizonte azul profundo → cénit negro.
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uHorizon: { value: new THREE.Color(0x08131f) },
        uZenith: { value: new THREE.Color(0x02040a) },
        uDim: { value: 1.0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uHorizon; uniform vec3 uZenith; uniform float uDim;
        varying vec3 vPos;
        void main() {
          float h = clamp(normalize(vPos).y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
          gl_FragColor = vec4(col * uDim, 1.0);
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(80, 32, 16), this.skyMat);

    const { die, rim, rimMat } = this.buildDie(chipWidth, chipDepth);
    this.rimMat = rimMat;

    this.group.add(mirror, grid, sky, die, rim);
  }

  /**
   * El sustrato: una pastilla de esquinas redondeadas bajo la retícula, con el borde
   * marcado. Sin él, los 156 cúbits se leen como una textura que se sale del encuadre;
   * con él, el campo es **una pieza** con principio y final.
   */
  private buildDie(chipWidth: number, chipDepth: number) {
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
    const die = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x070d16 }));

    // Borde superior iluminado: es lo que dibuja la silueta de la pieza.
    const pts = shape.getPoints(96).map((p) => new THREE.Vector3(p.x, DIE_TOP + 0.004, p.y));
    const rimMat = new THREE.LineBasicMaterial({ color: 0x4fd0ee, transparent: true, opacity: 0.55 });
    const rim = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), rimMat);

    return { die, rim, rimMat };
  }

  /** Atenúa suelo, cielo y borde al enfocar un territorio (`focus` de 0 a 1). */
  setFocus(focus: number): void {
    this.gridMat.uniforms.uDim.value = 1 - 0.6 * focus;
    this.skyMat.uniforms.uDim.value = 1 - 0.55 * focus;
    this.rimMat.opacity = 0.55 * (1 - 0.6 * focus);
  }
}
