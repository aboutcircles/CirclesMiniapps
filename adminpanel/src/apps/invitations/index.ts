import './style.css';
import { HTML } from './template';
import type { MiniApp } from '../../shared/app';

let booted = false;
const app: MiniApp = {
  async mount(root: HTMLElement) {
    root.innerHTML = HTML;
    if (booted) return;        // defensive: boot only once
    booted = true;
    const { boot } = await import('./app');
    boot();
  },
};
export default app;
