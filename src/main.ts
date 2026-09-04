import './style.css';
import { App } from './scene/App';
import { Overlay } from './ui/Overlay';
import { MENU } from './menu';

const overlay = new Overlay(document.getElementById('ui')!);
const app = new App(document.getElementById('app')!, MENU, overlay);

// Punto de integración: aquí es donde el menú "navega".
// Sustituye este cuerpo por tu router, un cambio de vista, etc.
app.onNavigate = (item, sub) => {
  overlay.toast(`<b>${item.label}</b> → ${sub.label}`);
  console.log('[navigate]', item.id, '/', sub.id);
};
