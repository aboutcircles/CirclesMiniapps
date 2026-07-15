// Buffer / global shim — must run before any @aboutcircles SDK or viem code
// that some app paths assume Node-like globals for.
import { Buffer } from 'buffer';
if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = Buffer;

import './shared/shell.css';
import type { AppDefinition, MiniApp } from './shared/app';

// ── Registered apps ─────────────────────────────────────────────────────────
// Each app is lazily imported so its SDK bundle loads only when first visited.
const APPS: AppDefinition[] = [
  { route: 'group',       load: () => import('./apps/group/index').then(m => m.default) },
  { route: 'org',         load: () => import('./apps/org/index').then(m => m.default) },
  { route: 'invitations', load: () => import('./apps/invitations/index').then(m => m.default) },
];

const ROOT = document.getElementById('mm-app-root') as HTMLElement;

// Cache of mounted apps. We keep each app's DOM subtree in memory once mounted
// and toggle visibility on navigation, so module-level state (connected wallet,
// loaded groups, etc.) survives a round-trip between routes — same as the
// standalone apps, which never tear down on view switch.
interface MountedApp {
  def: AppDefinition;
  instance: MiniApp;
  container: HTMLElement;
}
const mounted = new Map<string, MountedApp>();
let activeRoute: string | null = null;
let mounting: string | null = null;

function parseRoute(): string {
  // #/group → "group"; empty / unknown → "" (landing)
  const hash = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return hash || '';
}

function setActiveNav(route: string): void {
  document.querySelectorAll<HTMLAnchorElement>('.mm-nav-link').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === route);
  });
}

function renderLanding(): void {
  ROOT.innerHTML = `
    <div class="mm-landing">
      <h1>Circles Miniapps</h1>
      <p class="lead">A unified home for the Circles management miniapps. Pick a tool to get started — each one connects to your wallet through the Circles host app.</p>
      <div class="mm-cards">
        <a class="mm-card" href="#/group">
          <span class="mm-card-title">Groups Manager</span>
          <span class="mm-card-desc">Create and manage Circles groups: members, treasury, profile and admins.</span>
          <span class="mm-card-cta">Open Groups →</span>
        </a>
        <a class="mm-card" href="#/org">
          <span class="mm-card-title">Organization Manager</span>
          <span class="mm-card-desc">Register dedicated organization accounts, manage trusted tokens, signers and withdrawals.</span>
          <span class="mm-card-cta">Open Organizations →</span>
        </a>
        <a class="mm-card" href="#/invitations">
          <span class="mm-card-title">Invitation Links Manager</span>
          <span class="mm-card-desc">Create magic links and manage invitation campaigns from your quota.</span>
          <span class="mm-card-cta">Open Invitations →</span>
        </a>
      </div>
    </div>`;
}

function hideAllContainers(): void {
  mounted.forEach((m) => { m.container.style.display = 'none'; });
}

async function navigate(): Promise<void> {
  const route = parseRoute();
  setActiveNav(route);

  // Landing page.
  if (!route) {
    hideAllContainers();
    activeRoute = null;
    renderLanding();
    return;
  }

  const def = APPS.find((a) => a.route === route);
  if (!def) {
    hideAllContainers();
    activeRoute = null;
    renderLanding();
    return;
  }

  // Already mounted → just re-show it.
  const existing = mounted.get(route);
  if (existing) {
    // Remove the landing markup if present.
    if (!activeRoute) ROOT.querySelector('.mm-landing')?.remove();
    hideAllContainers();
    existing.container.style.display = '';
    activeRoute = route;
    return;
  }

  // First visit → lazily load + mount.
  if (mounting === route) return;
  mounting = route;
  hideAllContainers();
  if (!activeRoute) ROOT.querySelector('.mm-landing')?.remove();

  const loadingEl = document.createElement('div');
  loadingEl.className = 'mm-loading';
  loadingEl.textContent = 'Loading…';
  ROOT.appendChild(loadingEl);

  try {
    const instance = await def.load();
    // Guard against the user navigating away while the chunk was loading.
    loadingEl.remove();

    const container = document.createElement('div');
    container.className = 'mm-app-mount';
    container.dataset.app = route;
    ROOT.appendChild(container);

    await instance.mount(container);
    mounted.set(route, { def, instance, container });

    // If the user navigated elsewhere mid-mount, hide this one.
    if (parseRoute() !== route) {
      container.style.display = 'none';
    } else {
      activeRoute = route;
    }
  } catch (err) {
    loadingEl.remove();
    const errEl = document.createElement('div');
    errEl.className = 'mm-loading';
    errEl.textContent = `Failed to load the "${route}" app. Check the console for details.`;
    ROOT.appendChild(errEl);
    // eslint-disable-next-line no-console
    console.error(`[router] failed to mount "${route}"`, err);
  } finally {
    mounting = null;
  }
}

window.addEventListener('hashchange', navigate);
navigate();
