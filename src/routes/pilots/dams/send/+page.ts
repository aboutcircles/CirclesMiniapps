// NOT prerendered on purpose: emitting pilots/dams/send.html would create a
// real pilots/dams/ directory in the static build output, which shadows the
// prerendered /pilots/dams page on the server (301 → 403; see commit 381994c).
// The route is served through the SPA fallback and rendered client-side, like
// every other page (ssr is off globally).
export const prerender = false;
