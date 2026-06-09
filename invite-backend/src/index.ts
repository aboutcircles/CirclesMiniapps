/**
 * circles-invite-backend — minimal Hono service.
 *
 * POST /invite  { account: "0x<newSafe>", app?: "<origin>" }  → invites the
 *               account into Circles via the InvitationFarm. `app` (the miniapp
 *               origin, supplied by the trusted host) is recorded for attribution.
 * GET  /health  → { ok: true }
 * GET  /stats   → per-app signup counts (JSON file, no database).
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { isAddress, type Address } from 'viem';
import { inviteAccount, loadEnv } from './invite.js';
import { getStats, initStats, recordSignup } from './stats.js';

const PORT = Number(process.env.PORT ?? 8787);

// /invite may only be called from gnosis.io and its subdomains. The base domain is
// configurable; comma-separate extra dev origins (e.g. http://localhost:5173) if
// you need them locally.
const ALLOWED_BASE_DOMAIN = (process.env.ALLOWED_BASE_DOMAIN ?? 'gnosis.io').toLowerCase();
const EXTRA_ALLOWED_ORIGINS = (process.env.EXTRA_ALLOWED_ORIGINS ?? '')
	.split(',')
	.map((s) => s.trim().toLowerCase())
	.filter(Boolean);

/**
 * Is `origin` allowed to call /invite? Allows https://gnosis.io and
 * https://*.gnosis.io (any subdomain), plus any explicitly listed extra origins.
 * Exact host match on the base domain, suffix match (".<base>") for subdomains —
 * so "evilgnosis.io" or "gnosis.io.attacker.com" are rejected.
 */
function isAllowedOrigin(origin: string | null | undefined): boolean {
	if (!origin) return false;
	const o = origin.toLowerCase();
	if (EXTRA_ALLOWED_ORIGINS.includes(o)) return true;
	let host: string;
	try {
		const u = new URL(origin);
		if (u.protocol !== 'https:') return false; // require https for the real domain
		host = u.hostname.toLowerCase();
	} catch {
		return false;
	}
	return host === ALLOWED_BASE_DOMAIN || host.endsWith('.' + ALLOWED_BASE_DOMAIN);
}

/** Derive an origin (scheme://host[:port]) from a Referer URL, if present. */
function originFromReferer(referer: string | null | undefined): string | null {
	if (!referer) return null;
	try {
		return new URL(referer).origin;
	} catch {
		return null;
	}
}

// Validate inviter env up front so the process fails loudly on misconfig.
const env = loadEnv();

const app = new Hono();

// CORS for /invite: reflect the origin only when it's an allowed gnosis.io origin.
app.use(
	'/invite',
	cors({
		origin: (origin) => (isAllowedOrigin(origin) ? origin : null),
		allowMethods: ['POST', 'OPTIONS'],
		allowHeaders: ['Content-Type']
	})
);
// /stats is read-only aggregate data — allow from anywhere for easy dashboards.
app.use('/stats', cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] }));

app.get('/health', (c) => c.json({ ok: true }));

// Per-app signup attribution — served straight from the JSON store.
app.get('/stats', (c) => c.json(getStats()));

/** Normalise the host-supplied app identifier; default 'direct'. */
function normalizeApp(raw: unknown): string {
	if (typeof raw !== 'string') return 'direct';
	const v = raw.trim().slice(0, 200);
	return v.length ? v : 'direct';
}

// In-memory per-IP rate limit. Two windows so we throttle bursts AND cap totals:
//   - short window: RATE_MAX requests per RATE_WINDOW_MS (default 5 / 60s)
//   - daily window: RATE_DAILY_MAX requests per 24h (default 20)
// Each /invite consumes a unit of farm quota, so the limit protects both the
// inviter's quota and the hot key. Tune via env.
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS ?? 60_000);
const RATE_MAX = Number(process.env.RATE_MAX ?? 5);
const RATE_DAILY_MAX = Number(process.env.RATE_DAILY_MAX ?? 20);
const DAY_MS = 24 * 60 * 60 * 1000;

const hits = new Map<string, number[]>();

/** Returns { limited, retryAfter } for an IP, recording the hit if allowed. */
function checkRateLimit(ip: string): { limited: boolean; retryAfter: number } {
	const now = Date.now();
	// Keep only timestamps from the last 24h.
	const arr = (hits.get(ip) ?? []).filter((t) => t > now - DAY_MS);

	const inShortWindow = arr.filter((t) => t > now - RATE_WINDOW_MS);
	if (inShortWindow.length >= RATE_MAX) {
		hits.set(ip, arr);
		const oldest = Math.min(...inShortWindow);
		return { limited: true, retryAfter: Math.ceil((oldest + RATE_WINDOW_MS - now) / 1000) };
	}
	if (arr.length >= RATE_DAILY_MAX) {
		hits.set(ip, arr);
		const oldest = Math.min(...arr);
		return { limited: true, retryAfter: Math.ceil((oldest + DAY_MS - now) / 1000) };
	}

	arr.push(now);
	hits.set(ip, arr);
	return { limited: false, retryAfter: 0 };
}

// Periodically drop IPs with no activity in the last 24h so the map can't grow
// without bound.
setInterval(() => {
	const cutoff = Date.now() - DAY_MS;
	for (const [ip, arr] of hits) {
		const fresh = arr.filter((t) => t > cutoff);
		if (fresh.length === 0) hits.delete(ip);
		else hits.set(ip, fresh);
	}
}, 60 * 60 * 1000).unref();

app.post('/invite', async (c) => {
	// Hard origin gate: only gnosis.io (and subdomains) may invite. CORS alone is
	// browser-only — this also blocks non-browser clients (curl, scripts).
	const origin = c.req.header('origin') ?? originFromReferer(c.req.header('referer'));
	if (!isAllowedOrigin(origin)) {
		return c.json({ error: 'Forbidden: invites may only be requested from gnosis.io.' }, 403);
	}

	const ip =
		c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
		c.req.header('x-real-ip') ||
		'unknown';
	const rl = checkRateLimit(ip);
	if (rl.limited) {
		c.header('Retry-After', String(rl.retryAfter));
		return c.json(
			{ error: 'Rate limit exceeded. Please try again later.', retryAfter: rl.retryAfter },
			429
		);
	}

	let body: { account?: string; app?: string };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: 'Invalid JSON body' }, 400);
	}

	const account = body.account;
	if (!account || !isAddress(account, { strict: false })) {
		return c.json({ error: 'Body must be { account: "0x<address>" }' }, 400);
	}
	// The app identifier is supplied by the trusted host (iframe origin), not the
	// miniapp itself, so it can't be spoofed.
	const appId = normalizeApp(body.app);

	try {
		const result = await inviteAccount(account as Address, env);
		// Only count actual registrations (not 'already' / skipped).
		if (result.status === 'invited') {
			await recordSignup(appId, new Date().toISOString());
		}
		return c.json(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[invite] failed for', account, '(app:', appId, ') -', message);
		return c.json({ error: message }, 502);
	}
});

// Load the JSON signup-stats file before serving. Never fatal.
await initStats().catch((err) => {
	console.error('[stats] init failed, continuing:', err instanceof Error ? err.message : err);
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
	console.log(`circles-invite-backend listening on http://localhost:${info.port}`);
	console.log(`  inviter Safe: ${env.inviterSafe}`);
	console.log(
		`  /invite allowed origins: https://${ALLOWED_BASE_DOMAIN} (+ *.${ALLOWED_BASE_DOMAIN})` +
			(EXTRA_ALLOWED_ORIGINS.length ? `, ${EXTRA_ALLOWED_ORIGINS.join(', ')}` : '')
	);
	console.log(
		`  rate limit: ${RATE_MAX}/${Math.round(RATE_WINDOW_MS / 1000)}s, ${RATE_DAILY_MAX}/day per IP`
	);
	console.log(`  signup stats: GET /stats (file: ${process.env.STATS_FILE ?? './data/stats.json'})`);
});
