// Contract every consolidated miniapp module implements.
//
// Each app keeps its original monolithic logic almost verbatim. The only
// structural change is that the logic — which caches DOM nodes via
// getElementById and wires listeners at module scope — runs inside mount()
// AFTER the app's HTML has been injected into `root`, instead of at import
// time against a static index.html.
export interface MiniApp {
  /** Inject the app's DOM into `root` and run its bootstrap (wallet listener,
   *  element caching, event wiring). Called once, the first time the route is
   *  visited. */
  mount(root: HTMLElement): void | Promise<void>;
  /** Optional teardown. Most apps just hide; the router caches the mounted DOM
   *  and re-shows it on return so per-session state survives, matching the
   *  standalone apps' behavior. */
  unmount?(): void;
}

export interface AppDefinition {
  route: string;
  /** Lazy loader so each app's heavy SDK bundle only loads when first visited. */
  load: () => Promise<MiniApp>;
}
