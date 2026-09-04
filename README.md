# Campo · Menú interactivo 3D (propuesta 2)

Segunda propuesta de menú para el Centro de Computación Cuántica IBM-Euskadi (Donostia).
Hermana de `../bloch` (propuesta 1, esfera de Bloch): comparte el contenido del menú y
el panel, pero la experiencia 3D es distinta.

## Concepto

Los **156 cúbits** se disponen tal y como están en el procesador IBM Quantum Heron:
una retícula **heavy-hex** de 8 filas de 16 cúbits unidas por 28 cúbits puente, tendida
sobre un suelo de cristal oscuro que la refleja. La cámara sobrevuela el campo.

- Los cúbits ondulan suavemente y, cada pocos segundos, una **onda de excitación** nace
  en uno de ellos y se propaga por los acopladores encendiéndolos a su paso.
- Los **territorios** son cúbits-tótem con un haz de luz vertical y su nombre.
- Al pulsar uno, la cámara **vuela** hasta él y sus subsecciones **se elevan** del campo y se
  despliegan en un **arco ordenado** detrás del territorio (de izquierda a derecha, como en el
  panel), cada una con su pilar de luz. El resto del campo se atenúa y se abre el panel.
  Al salir, la cámara vuelve al plano general.
- El campo flota sobre un espejo atenuado que se desvanece con la distancia.

## Stack

- [Vite](https://vite.dev) + TypeScript
- [Three.js](https://threejs.org) (WebGL, postprocesado con bloom, etiquetas CSS2D)

## Uso

```bash
npm install
npm run dev      # servidor de desarrollo
npm run build    # compila en dist/
npm run preview  # sirve dist/
```

## Interacción

| Acción | Resultado |
| --- | --- |
| Arrastrar | Orbita la cámara |
| Rueda / pellizco | Zoom |
| Hover sobre un cúbit | Muestra su índice (Q·042) y lo eleva un poco |
| Clic en un territorio | La cámara vuela hasta él, sus subsecciones se elevan y se abre el panel. El resto se atenúa |
| Clic en una subsección o botón del panel | Dispara `app.onNavigate(item, sub)` |
| Esc / clic en vacío / × | Cierra y devuelve la cámara al plano general |

## Estructura

```
src/
├─ main.ts            # arranque; aquí conectas onNavigate con tu router
├─ menu.json          # ← contenido del menú (copia sincronizada con ../bloch)
├─ menu.ts            # tipos del menú y QUBIT_COUNT
├─ style.css          # UI HTML, ficha de cúbits y estilos de las etiquetas 3D
├─ ui/Overlay.ts      # panel lateral, contador de cúbits y toasts
└─ scene/
   ├─ App.ts          # renderer, cámara y vuelos, controles, bloom, raycast, eventos
   ├─ HeavyHex.ts     # topología: 156 cúbits, 176 acopladores, BFS
   ├─ QubitField.ts   # cúbits, acopladores, ondas, territorios y subsecciones
   ├─ Ground.ts       # suelo espejo, rejilla y cúpula
   ├─ Dust.ts         # motas de polvo luminoso
   └─ helpers.ts      # texturas, etiquetas, utilidades
```

El contenido del menú se edita en `src/menu.json` (mismo formato que en `../bloch`).
