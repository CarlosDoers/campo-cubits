import type { Territory, SubItem } from '../menu';

/** Controla la capa HTML: panel lateral de submenú y toasts. */
export class Overlay {
  onClose: () => void = () => {};
  onSubClick: (item: Territory, sub: SubItem) => void = () => {};

  private readonly panel: HTMLElement;
  private readonly title: HTMLElement;
  private readonly desc: HTMLElement;
  private readonly list: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly qubitCount: HTMLElement;
  private readonly circuitLine: HTMLElement;
  private toastTimer = 0;

  constructor(root: HTMLElement) {
    this.panel = root.querySelector('#panel')!;
    this.title = root.querySelector('.panel-title')!;
    this.desc = root.querySelector('.panel-desc')!;
    this.list = root.querySelector('.panel-list')!;
    this.toastEl = root.querySelector('#toast')!;
    this.qubitCount = root.querySelector('#qubit-count')!;
    this.circuitLine = root.querySelector('#circuit')!;

    root.querySelector('.panel-close')!.addEventListener('click', () => this.onClose());
  }

  showItem(item: Territory): void {
    this.panel.style.setProperty('--accent', item.color);
    this.title.textContent = item.label;
    this.desc.textContent = item.description;

    this.list.replaceChildren(
      ...item.items.map((sub) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.innerHTML =
          `<span class="dot"></span><span>${sub.label}` +
          (sub.description ? `<small>${sub.description}</small>` : '') +
          `</span><span class="arrow">→</span>`;
        btn.addEventListener('click', () => this.onSubClick(item, sub));
        li.appendChild(btn);
        return li;
      }),
    );

    this.panel.classList.add('open');
    this.panel.setAttribute('aria-hidden', 'false');
  }

  setQubitCount(n: number): void {
    this.qubitCount.textContent = String(n);
  }

  /** Qué está haciendo el chip ahora mismo (capa del circuito, medida, reposo). */
  setCircuit(text: string): void {
    this.circuitLine.textContent = text;
  }

  hide(): void {
    this.panel.classList.remove('open');
    this.panel.setAttribute('aria-hidden', 'true');
  }

  toast(html: string, ms = 2200): void {
    this.toastEl.innerHTML = html;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }
}
