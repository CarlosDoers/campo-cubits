/**
 * La paleta del site, en un solo sitio y compartida por la escena 3D y el CSS.
 *
 * Es **un acento y neutros**, a propósito. Antes había cinco colores puros repartidos
 * por la rueda —40°, 128°, 190°, 255°, 313°, todos a valor máximo—, que es lo que sale
 * cuando se elige un color por sección en vez de una paleta. Con un solo acento la
 * jerarquía es automática: si solo hay un color, solo puede destacar una cosa a la vez.
 *
 * Los valores tienen que coincidir con los tokens de `style.css`.
 */
export const PALETTE = {
  /** Fondo de la escena. */
  bg: 0x05070b,
  /** Estructura: retícula, acopladores, líneas. Nunca emite luz. */
  line: 0x2a3440,
  /** Un punto por encima de la línea: los cúbits en reposo. */
  quiet: 0x4a5a6b,
  /** Texto y elementos secundarios. */
  dim: 0x8b97a6,
  /** Texto principal y cúbits activos. */
  text: 0xe8edf3,
  /** El único acento. Reservado para lo seleccionado y para lo que de verdad pasa. */
  accent: 0x4fd0ee,
} as const;

/** El acento en formato CSS, para las etiquetas HTML. */
export const ACCENT_CSS = '#4fd0ee';
