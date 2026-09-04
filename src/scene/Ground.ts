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

/** Suelo de cristal oscuro que refleja el campo, rejilla tenue y cúpula degradada. */
export class Ground {
  readonly group = new THREE.Group();

  private readonly gridMat: THREE.ShaderMaterial;
  private readonly skyMat: THREE.ShaderMaterial;

  constructor(size = 240) {
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

    this.group.add(mirror, grid, sky);
  }

  /** Atenúa suelo y cielo al enfocar un territorio (`focus` de 0 a 1). */
  setFocus(focus: number): void {
    this.gridMat.uniforms.uDim.value = 1 - 0.6 * focus;
    this.skyMat.uniforms.uDim.value = 1 - 0.55 * focus;
  }
}
