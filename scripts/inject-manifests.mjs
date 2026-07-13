// Inject the per-page web-app manifest link into the built HTML.
//
// The app renders client-side only (ssr=false), so a <svelte:head> manifest
// link appears only after hydration — too late for the browser's install-time
// evaluation, which reads the initial HTML. And a placeholder href in app.html
// crashes the prerender crawler (decodeURI on the raw "%"). So the link is
// added here, after `vite build`, straight into the emitted files: the dAMS
// pilot page gets its own manifest (start_url /pilots/dams), everything else
// gets the Miniapps one. src/routes/+layout.svelte keeps the href correct
// across client-side navigations.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const BUILD_DIR = 'build';

function manifestFor(relPath) {
	return relPath === 'pilots/dams.html' ? '/pilots/dams.webmanifest' : '/manifest.webmanifest';
}

function htmlFiles(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = join(dir, e.name);
		if (e.isDirectory()) return htmlFiles(p);
		return e.name.endsWith('.html') ? [p] : [];
	});
}

let injected = 0;
for (const file of htmlFiles(BUILD_DIR)) {
	const html = readFileSync(file, 'utf8');
	if (html.includes('rel="manifest"')) continue;
	const link = `<link rel="manifest" href="${manifestFor(relative(BUILD_DIR, file))}" />`;
	if (!html.includes('</head>')) continue;
	writeFileSync(file, html.replace('</head>', `${link}\n\t</head>`));
	injected++;
}
console.log(`inject-manifests: added manifest link to ${injected} page(s)`);
