import data from './menu.json';

/** Cúbits físicos del IBM Quantum Heron instalado en Donostia. */
export const QUBIT_COUNT = 156;

/**
 * El contenido del menú vive en `menu.json`. Este módulo solo lo tipa:
 * si falta un campo obligatorio, `npm run build` avisa.
 *
 * - Un **territorio** (nivel principal) es un cúbit destacado sobre la esfera.
 * - Sus **items** se despegan de la esfera como subsecciones al seleccionarlo.
 */
export interface SubItem {
  id: string;
  label: string;
  /** Segunda línea en el panel lateral. */
  description?: string;
}

export interface Territory {
  id: string;
  label: string;
  description: string;
  items: SubItem[];
}

export const MENU: Territory[] = data.territorios;
