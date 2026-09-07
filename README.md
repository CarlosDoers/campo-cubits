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

## Entrada

El arranque va en tres tiempos, porque es lo primero que ve cualquiera:

1. **0 – 0,9 s.** El borde del sustrato se traza solo, de una punta a la otra. El chip
   todavía está apagado.
2. **0,9 – 2,9 s.** Un **frente de encendido** cruza la pastilla en diagonal levantando
   los cúbits desde debajo del sustrato: cada uno da un destello al subir y remata con
   un pequeño rebote, y los acopladores prenden justo detrás del frente. El contador del
   HUD sube de 0 a 156 al ritmo del frente.
3. **3,05 s.** Arranca el circuito y el HUD pasa de «Encendiendo el procesador» a
   contar capas.

La cámara acompaña: empieza cerca y casi a ras del sustrato y se retira al plano general
a lo largo de los 3,4 s, así que el chip se revela a la vez que se enciende.

Los **territorios** son cúbits-tótem con un haz vertical corto y su nombre encima.

Al pulsar uno **no aparece nada nuevo**: el subnivel son cúbits que ya estaban en el
campo. Cada territorio vive en una fila que tiene puente hacia la de arriba, y sus
subsecciones son las columnas contiguas de esa fila superior. Se encienden en cadena
—tótem, puente, fila— recorriendo los acopladores reales, así que el submenú es la
propia topología del chip haciendo de menú. Al abrirse, el haz del tótem se desvanece:
no queda ni una línea que no sea un acoplador de verdad.

Las subsecciones **no se elevan ni se separan**: se quedan exactamente donde están en la
retícula. Antes se despegaban del campo y se abrían en abanico para que cupieran sus
etiquetas, y era justo lo que delataba el truco —el chip dejaba de ser un chip—. Ahora
de que quepan se encarga la cámara.

El encuadre de la sección abierta (`focusPose`) se calcula así:

- **Azimut fijo mirando desde +Z**, no el actual. Las filas tienen que salir
  horizontales, o la fila de las hijas no queda encima de la sección.
- **Picado** (`FOCUS_PITCH`), al revés que el plano general. Rasante las dos filas se
  aplastaban una contra otra y el subnivel no se leía como una fila encima de su sección,
  sino como un montón. Desde arriba la separación vertical entre filas sale casi el doble
  que el paso entre columnas y la retícula se lee como lo que es.
- **Distancia por legibilidad**: se acerca hasta que una columna del chip ocupa
  `LABEL_ROOM` píxeles, que es el sitio que necesita una etiqueta. Como suelo queda el
  encaje geométrico del grupo, por si el encuadre es tan estrecho que acercarse dejaría
  fuera a las hijas de los extremos. El vuelo se nota mucho más que antes, y esa es la
  otra mitad de la gracia: compensa que las esferas ya no se muevan.
- **La sección cae abajo en el centro** del hueco que deja el panel. El desplazamiento
  se calcula a la profundidad del tótem, no a la del objetivo: va por delante, se
  proyecta más grande y la misma distancia en el mundo lo corre bastante más en
  pantalla. Con un valor fijo se iba medio encuadre a la izquierda.

Abierta, la etiqueta pequeña de la sección **se apaga** y su nombre pasa a leerse a
cuerpo de titular en el margen izquierdo, alineado con el logotipo y las ayudas. Es el
único titular de la página: la escena se queda con las etiquetas pequeñas de las hijas y
el panel con la lista, así que el nombre se dice una vez y grande. Antes se probó a
colocarlo encima de su esfera —no cabe, el hueco entre las dos filas se lo reparten el
cúbit puente y su acoplador— y luego delante de ella; las dos veces acababa dicho tres
veces en la misma pantalla.

`separateLabels` queda de red para las ventanas bajas y anchas, donde la cámara tiene que
retroceder para que quepan las dos filas, las columnas se estrechan y las etiquetas se
rozan: entonces las escalona. Las recorre **en su orden de la retícula**, de izquierda a
derecha, y cada una pasa por encima de las anteriores con las que se cruce. El orden fijo
es lo importante: antes se ordenaban por su altura medida, que parecía lo natural, pero
están todas en la misma fila y cualquier temblor de un píxel les cambiaba el orden; la
escalera se rehacía al revés cada fotograma y se quedaban oscilando unas encima de otras
sin llegar a separarse nunca.

El resto del campo se atenúa pero **el circuito sigue corriendo**: el chip no deja de
trabajar mientras navegas. Y los demás tótems que queden en cuadro siguen siendo
pulsables, así que se salta de una sección a otra sin volver al plano general.

## Paleta

**Un acento y neutros**, en `src/palette.ts` y replicada en los tokens de `style.css`.

Antes había cinco colores puros repartidos por la rueda —40°, 128°, 190°, 255°, 313°,
todos a valor máximo—, uno por sección. Eso es lo que sale cuando se elige un color por
sección en vez de una paleta, y era lo que hacía que todo pareciera un árbol de navidad:
con cinco acentos, ninguno destaca.

Con un solo acento la jerarquía es automática. Las reglas de la casa:

- El acento es **solo para lo seleccionado** y para lo que de verdad está pasando.
- La estructura —retícula, acopladores, líneas— va en el color de línea y **no emite luz**.
- Los marcadores de sección están apagados en reposo; el brillo se lo gana el elegido.
- Mayúsculas espaciadas solo en dos sitios: el logotipo y el antetítulo del panel. Cuando
  todo es un micro-label espaciado no hay jerarquía tipográfica, solo textura.
- Nada de `backdrop-filter`, radios grandes, sombras enormes ni degradados de borde.

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
| Clic en un territorio | La cámara vuela hasta encajar el tótem abajo en el centro y su fila de hijas encima; el subnivel se enciende sobre la propia retícula y se abre el panel. El resto se atenúa |
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
   ├─ Ground.ts       # el sustrato del chip
   └─ helpers.ts      # texturas, etiquetas, utilidades
```

El contenido del menú se edita en `src/menu.json` (mismo formato que en `../bloch`).
`HeavyHex.ts` es el mismo módulo en las dos propuestas: campo tiende la retícula en un
plano y bloch la envuelve sobre la esfera.
