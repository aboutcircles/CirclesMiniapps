/**
 * Embedder allowlist for the /crc-signin connector.
 *
 * Only the origins listed here may embed /crc-signin in an iframe AND drive a
 * wallet connection / signature / transaction. An embed from any other site
 * renders an inert "not authorized" notice and the connector ignores every
 * postMessage it receives from a non-allowlisted origin.
 *
 * ── IMPORTANT ──────────────────────────────────────────────────────────────
 * This is the *in-page* (client-side) enforcement layer. It is real protection —
 * an unlisted embedder cannot connect a wallet or extract a signature — but the
 * AIRTIGHT control is the HTTP response header
 *     Content-Security-Policy: frame-ancestors <these origins>
 * which must be configured where the app is served (nginx on the droplet). A
 * <meta> tag cannot set frame-ancestors. Keep this list and the nginx
 * frame-ancestors directive in sync.
 *
 * ── HOW TO EDIT ────────────────────────────────────────────────────────────
 * Put the EXACT origins you trust in ALLOWED_EMBEDDER_ORIGINS below. An origin
 * is scheme + host + port with NO trailing slash and NO path, e.g.
 *     'https://app.partner.com'
 *     'https://circles.gnosis.io'
 * Wildcard subdomains are supported via a leading '*.', matching the registrable
 * domain and any subdomain over HTTPS:
 *     'https://*.gnosis.io'  → https://gnosis.io, https://circles.gnosis.io, ...
 * localhost (any port) is matched by the DEV entries; remove them for production
 * if you want to forbid local embedding.
 */

// ⬇️  EDIT THIS LIST — the only origins permitted to embed and log users in.
export const ALLOWED_EMBEDDER_ORIGINS: string[] = [
	// --- Circles first-party ---
	'https://*.gnosis.io',

	// --- Demo / partner sites ---
	'https://web3skeptic.github.io',

	// --- Local development (remove for a locked-down production build) ---
	'http://localhost',
	'http://127.0.0.1'
];

/**
 * Whether the given origin (e.g. event.origin or new URL(referrer).origin) is
 * allowed to embed/drive the connector.
 *
 * - Exact match against any non-wildcard entry.
 * - Wildcard 'https://*.gnosis.io' matches https://gnosis.io and any subdomain.
 * - localhost / 127.0.0.1 entries match that host on ANY port (dev convenience).
 */
export function isAllowedEmbedder(origin: string | null | undefined): boolean {
	if (!origin || origin === 'null') return false;

	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return false;
	}
	const scheme = url.protocol.replace(':', '');
	const host = url.hostname;

	for (const entry of ALLOWED_EMBEDDER_ORIGINS) {
		let entryUrl: URL;
		try {
			// Wildcard host can't be parsed by URL directly; swap a placeholder in.
			entryUrl = new URL(entry.replace('*.', 'wildcard.'));
		} catch {
			continue;
		}
		const entryScheme = entryUrl.protocol.replace(':', '');
		if (entryScheme !== scheme) continue;

		const isWildcard = entry.includes('://*.');
		if (isWildcard) {
			// e.g. entry 'https://*.gnosis.io' → base domain 'gnosis.io'
			const baseDomain = entryUrl.hostname.replace(/^wildcard\./, '');
			if (host === baseDomain || host.endsWith('.' + baseDomain)) return true;
			continue;
		}

		// localhost / 127.0.0.1 entries: match host on any port.
		if (entryUrl.hostname === 'localhost' || entryUrl.hostname === '127.0.0.1') {
			if (host === entryUrl.hostname) return true;
			continue;
		}

		// Exact origin match (host + explicit port if the entry specified one).
		if (host !== entryUrl.hostname) continue;
		if (entryUrl.port && entryUrl.port !== url.port) continue;
		return true;
	}

	return false;
}
