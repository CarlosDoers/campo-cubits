# Campo · Menú interactivo 3D (propuesta 2)

Segunda propuesta de menú para el Centro de Computación Cuántica IBM-Euskadi (Donostia).
Hermana de `../bloch` (propuesta 1, esfera de Bloch): comparte el contenido del menú y
el panel, pero cuenta otra cosa.

## Concepto

**Bloch enseña el estado; Campo enseña el proceso.** Aquí el chip no es un decorado:
está *trabajando*, y eso es lo que se ve.

Los **156 cúbits** se disponen como en el procesador IBM Quantum Heron: una retícula
**heavy-hex** de 8 filas de 16 cúbits unidas por 28 cúbits puente, sobre un sustrato de
esquinas redondeadas con el borde iluminado. La retícula es exacta —sin desorden— para
que se lean los hexágonos, y los cúbits puente son más pequeños, como en los diagramas
de IBM. La cámara encuadra siempre el chip entero.

Encima corre un **circuito** (`Circuit.ts`), que no simula nada pero marca el ritmo de
lo que pasa en la máquina:

- El circuito avanza por **capas**, que el HUD va contando (`Capa 7/11 · CZ`). Las capas
  **no se pintan**. Se probó a encenderlas —cada capa disparaba sus puertas y el chip
  destellaba— y no funciona: una capa es simultánea, así que se encienden ~90 cúbits en
  el mismo fotograma y salen destellos globales seguidos. En un menú eso cansa, compite
  con la navegación y es mal asunto para gente fotosensible. **El circuito se cuenta,
  no se destella.**
- El acontecimiento visible es la **medida**: un frente de lectura cruza el chip y cada
  cúbit colapsa a |0⟩ (azul) o |1⟩ (rosa). El patrón se queda unos segundos y se
  desvanece. Al pasar el ratón por un cúbit ya medido, el tooltip da su valor.

Los **territorios** son cúbits-tótem con un haz vertical corto y su nombre encima. Al
pulsar uno, la cámara conserva el azimut —la transición se lee como un empujón, no como
un salto— pero **baja hasta casi rasar el chip** (`FOCUS_PITCH`), que así se ve de canto
y sirve de suelo. Sus subsecciones se
despegan del campo y quedan **flotando repartidas alrededor del tótem**, cada una a su
altura. Sin líneas de ningún tipo: al abrirse, hasta el haz del tótem se desvanece, y lo
que agrupa las subsecciones es el color y la cercanía. El nombre del territorio sube a
coronar el grupo. El resto se atenúa pero **el circuito sigue corriendo**: el chip no
deja de trabajar mientras navegas.

El reparto se calcula **relativo a la cámara**, no en coordenadas del chip: si no,
depende del ángulo desde el que abras el territorio y unas veces sale repartido y otras
se amontona. Las alturas alternan alta y baja, que es lo que impide que las etiquetas se
pisen —de ancho no hay sitio para ponerlas seguidas—. Y como eso depende del texto,
`separateLabels` hace de red: si dos llegan a tocarse, empuja la de arriba lo justo. El
desplazamiento es pequeño y suavizado, así que no se nota, pero garantiza que se lean
aunque cambie el contenido del menú.

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
| Hover sobre un cúbit | Muestra su índice (Q·042) y, si ya se ha medido, su valor |
| Clic en un territorio | La cámara se acerca, sus subsecciones se elevan sobre el tótem y se abre el panel. El resto se atenúa |
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
   ├─ App.ts          # renderer, cámara (encaja el chip entero), controles, bloom, raycast
   ├─ HeavyHex.ts     # topología: 156 cúbits, 176 acopladores, BFS
   ├─ Circuit.ts      # el circuito en marcha: cuenta de capas y medida
   ├─ QubitField.ts   # cúbits, acopladores y territorios; pinta el circuito encima
   ├─ Ground.ts       # sustrato del chip, suelo espejo, rejilla y cúpula
   ├─ Dust.ts         # motas de polvo luminoso
   └─ helpers.ts      # texturas, etiquetas, utilidades
```

El contenido del menú se edita en `src/menu.json` (mismo formato que en `../bloch`).
`HeavyHex.ts` es el mismo módulo en las dos propuestas: campo tiende la retícula en un
plano y bloch la envuelve sobre la esfera.
