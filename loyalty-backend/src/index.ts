/**
 * coffee-loyalty-backend — minimal Hono service.
 *
 * Powers the Coffee Loyalty miniapp. A customer scans the shop's daily QR, signs a
 * challenge in their wallet, and this service:
 *   - verifies the signature (EIP-1271 Safe signatures supported),
 *   - checks the QR's secret is today's (kills stale/screenshotted QRs),
 *   - caps one stamp per customer per day,
 *   - trusts first-time customers into the shop's Circles group (group Safe signs),
 *   - mints a free-coffee NFT on the 10th stamp.
 *
 * Endpoints:
 *   GET  /health                         → { ok }
 *   GET  /config                         → { owner, group, nft, stampsPerReward }
 *   GET  /customer/:address              → { stamps, rewards, isMember }
 *   POST /stamp   { address, secret, signature }
 *   POST /owner/dashboard { signature }  → owner-only: { secret, secretDate, customers }
 *   POST /redeem  { customer, tokenId, signature } → owner-only
 *
 * Modelled on invite-backend: same origin gate, rate limiter, and JSON-file store.
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getAddress, isAddress, type Address, type Hex } from 'viem';

import {
	ownerChallenge,
	redeemChallenge,
	stampChallenge,
	verifySignedBy
} from './challenge.js';
import { isHuman, isMember, trustMember, type TrustEnv } from './trust.js';
import { mintReward, type NftEnv } from './nft.js';
import {
	STAMPS_PER_REWARD,
	addReward,
	addStamp,
	allCustomers,
	getCustomer,
	getDailySecret,
	initStore,
	isCurrentSecret,
	markJoined,
	markRedeemed,
	stampedToday,
	todayUtc
} from './store.js';

// ─── Env ────────────────────────────────────────────────────────────
interface Env {
	rpcUrl: string;
	groupSafe: Address;
	owner: Address;
	operatorPrivateKey: Hex;
	nftContract: Address;
	requireHuman: boolean;
}

function loadEnv(): Env {
	const rpcUrl = process.env.RPC_URL;
	const groupSafe = process.env.GROUP_SAFE_ADDRESS;
	const owner = process.env.OWNER_ADDRESS;
	const operatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY;
	const nftContract = process.env.NFT_CONTRACT_ADDRESS;

	if (!rpcUrl) throw new Error('RPC_URL is not set');
	if (!groupSafe || !isAddress(groupSafe, { strict: false }))
		throw new Error('GROUP_SAFE_ADDRESS is not a valid address');
	if (!owner || !isAddress(owner, { strict: false }))
		throw new Error('OWNER_ADDRESS is not a valid address');
	if (!operatorPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(operatorPrivateKey))
		throw new Error('OPERATOR_PRIVATE_KEY is not a valid 32-byte hex key');
	if (!nftContract || !isAddress(nftContract, { strict: false }))
		throw new Error('NFT_CONTRACT_ADDRESS is not a valid address');

	return {
		rpcUrl,
		groupSafe: getAddress(groupSafe),
		owner: getAddress(owner),
		operatorPrivateKey: operatorPrivateKey as Hex,
		nftContract: getAddress(nftContract),
		requireHuman: process.env.REQUIRE_HUMAN === 'true'
	};
}

const env = loadEnv();
const trustEnv: TrustEnv = {
	rpcUrl: env.rpcUrl,
	groupSafe: env.groupSafe,
	operatorPrivateKey: env.operatorPrivateKey
};
const nftEnv: NftEnv = {
	rpcUrl: env.rpcUrl,
	operatorPrivateKey: env.operatorPrivateKey,
	nftContract: env.nftContract
};

// ─── Origin gate (mirrors invite-backend) ───────────────────────────
const PORT = Number(process.env.PORT ?? 8788);
const ALLOWED_BASE_DOMAIN = (process.env.ALLOWED_BASE_DOMAIN ?? 'gnosis.io').toLowerCase();
const EXTRA_ALLOWED_ORIGINS = (process.env.EXTRA_ALLOWED_ORIGINS ?? '')
	.split(',')
	.map((s) => s.trim().toLowerCase())
	.filter(Boolean);

function isAllowedOrigin(origin: string | null | undefined): boolean {
	if (!origin) return false;
	const o = origin.toLowerCase();
	if (EXTRA_ALLOWED_ORIGINS.includes(o)) return true;
	let host: string;
	try {
		const u = new URL(origin);
		if (u.protocol !== 'https:') return false;
		host = u.hostname.toLowerCase();
	} catch {
		return false;
	}
	return host === ALLOWED_BASE_DOMAIN || host.endsWith('.' + ALLOWED_BASE_DOMAIN);
}

function originFromReferer(referer: string | null | undefined): string | null {
	if (!referer) return null;
	try {
		return new URL(referer).origin;
	} catch {
		return null;
	}
}

// ─── Rate limit (per IP, two windows — same shape as invite-backend) ─
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS ?? 60_000);
const RATE_MAX = Number(process.env.RATE_MAX ?? 10);
const RATE_DAILY_MAX = Number(process.env.RATE_DAILY_MAX ?? 60);
const DAY_MS = 24 * 60 * 60 * 1000;
const hits = new Map<string, number[]>();

function checkRateLimit(ip: string): { limited: boolean; retryAfter: number } {
	const now = Date.now();
	const arr = (hits.get(ip) ?? []).filter((t) => t > now - DAY_MS);
	const inShort = arr.filter((t) => t > now - RATE_WINDOW_MS);
	if (inShort.length >= RATE_MAX) {
		hits.set(ip, arr);
		return { limited: true, retryAfter: Math.ceil((Math.min(...inShort) + RATE_WINDOW_MS - now) / 1000) };
	}
	if (arr.length >= RATE_DAILY_MAX) {
		hits.set(ip, arr);
		return { limited: true, retryAfter: Math.ceil((Math.min(...arr) + DAY_MS - now) / 1000) };
	}
	arr.push(now);
	hits.set(ip, arr);
	return { limited: false, retryAfter: 0 };
}

setInterval(() => {
	const cutoff = Date.now() - DAY_MS;
	for (const [ip, arr] of hits) {
		const fresh = arr.filter((t) => t > cutoff);
		if (fresh.length === 0) hits.delete(ip);
		else hits.set(ip, fresh);
	}
}, 60 * 60 * 1000).unref();

function clientIp(c: { req: { header: (k: string) => string | undefined } }): string {
	return (
		c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
		c.req.header('x-real-ip') ||
		'unknown'
	);
}

// ─── App ────────────────────────────────────────────────────────────
const app = new Hono();

// Writes are gated to gnosis.io origins; /config + /customer are public reads.
app.use('/stamp', cors({ origin: (o) => (isAllowedOrigin(o) ? o : null), allowMethods: ['POST', 'OPTIONS'], allowHeaders: ['Content-Type'] }));
app.use('/owner/*', cors({ origin: (o) => (isAllowedOrigin(o) ? o : null), allowMethods: ['POST', 'OPTIONS'], allowHeaders: ['Content-Type'] }));
app.use('/redeem', cors({ origin: (o) => (isAllowedOrigin(o) ? o : null), allowMethods: ['POST', 'OPTIONS'], allowHeaders: ['Content-Type'] }));
app.use('/config', cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] }));
app.use('/customer/*', cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] }));

app.get('/health', (c) => c.json({ ok: true }));

app.get('/config', (c) =>
	c.json({ owner: env.owner, group: env.groupSafe, nft: env.nftContract, stampsPerReward: STAMPS_PER_REWARD })
);

/** Public read of a customer's loyalty state. */
app.get('/customer/:address', async (c) => {
	const address = c.req.param('address');
	if (!isAddress(address, { strict: false })) return c.json({ error: 'Invalid address' }, 400);
	const addr = getAddress(address);
	const customer = getCustomer(addr);
	const member = await isMember(trustEnv, addr).catch(() => customer.joinedGroup);
	return c.json({ address: addr, stamps: customer.stamps, rewards: customer.rewards, isMember: member });
});

/** Require an allowed origin + apply the rate limit. Returns an error Response or null. */
function gate(c: any): Response | null {
	const origin = c.req.header('origin') ?? originFromReferer(c.req.header('referer'));
	if (!isAllowedOrigin(origin)) return c.json({ error: 'Forbidden: gnosis.io origins only.' }, 403);
	const rl = checkRateLimit(clientIp(c));
	if (rl.limited) {
		c.header('Retry-After', String(rl.retryAfter));
		return c.json({ error: 'Rate limit exceeded. Try again later.', retryAfter: rl.retryAfter }, 429);
	}
	return null;
}

/**
 * Collect a stamp. Body: { address, secret, signature }.
 * Trusts the customer into the group on first visit; mints a reward on the 10th.
 */
app.post('/stamp', async (c) => {
	const blocked = gate(c);
	if (blocked) return blocked;

	let body: { address?: string; secret?: string; signature?: string };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: 'Invalid JSON body' }, 400);
	}

	const { address, secret, signature } = body;
	if (!address || !isAddress(address, { strict: false }))
		return c.json({ error: 'Body must include a valid { address }' }, 400);
	if (typeof secret !== 'string' || typeof signature !== 'string')
		return c.json({ error: 'Body must include { secret, signature }' }, 400);

	const addr = getAddress(address);

	// 1. Secret must be the current day's — stale QRs are rejected.
	if (!(await isCurrentSecret(secret)))
		return c.json({ error: 'This QR code has expired. Please scan today’s code.' }, 403);

	// 2. Signature must prove the customer controls `addr` and saw this secret.
	const message = stampChallenge(env.groupSafe, secret);
	if (!(await verifySignedBy(env.rpcUrl, addr, message, signature as Hex)))
		return c.json({ error: 'Signature verification failed.' }, 401);

	// 3. Optional: only registered Circles humans may collect stamps.
	if (env.requireHuman && !(await isHuman(env.rpcUrl, addr)))
		return c.json({ error: 'Address is not a registered Circles account.' }, 403);

	// 4. One stamp per customer per day.
	if (stampedToday(addr)) {
		const customer = getCustomer(addr);
		return c.json({
			alreadyStampedToday: true,
			stamps: customer.stamps,
			stampsPerReward: STAMPS_PER_REWARD,
			justJoined: false,
			rewards: customer.rewards
		});
	}

	// 5. First visit → trust into the group (group Safe signs).
	let justJoined = false;
	const existing = getCustomer(addr);
	if (!existing.joinedGroup) {
		try {
			const alreadyMember = await isMember(trustEnv, addr);
			if (!alreadyMember) {
				await trustMember(trustEnv, addr);
				justJoined = true;
			}
			await markJoined(addr);
		} catch (err) {
			const m = err instanceof Error ? err.message : String(err);
			console.error('[stamp] trust failed for', addr, '-', m);
			return c.json({ error: 'Could not add you to the coffee shop group: ' + m }, 502);
		}
	}

	// 6. Add the stamp; mint a reward if we hit the threshold.
	let customer = await addStamp(addr);
	let reward = null;
	if (customer.stamps >= STAMPS_PER_REWARD) {
		try {
			const minted = await mintReward(nftEnv, addr);
			const rec = { tokenId: minted.tokenId, mintedAt: new Date().toISOString(), txHash: minted.txHash, redeemed: false };
			customer = await addReward(addr, rec); // resets stamps to 0
			reward = rec;
		} catch (err) {
			// Don't lose the stamp if minting fails — leave the counter at threshold
			// so a retry (next valid scan) can mint. Surface the error.
			const m = err instanceof Error ? err.message : String(err);
			console.error('[stamp] mint failed for', addr, '-', m);
			return c.json({ error: 'Stamp recorded, but minting the free coffee failed: ' + m, stamps: customer.stamps }, 502);
		}
	}

	return c.json({
		alreadyStampedToday: false,
		justJoined,
		stamps: customer.stamps,
		stampsPerReward: STAMPS_PER_REWARD,
		reward,
		rewards: customer.rewards
	});
});

/** Owner dashboard: today's QR secret + every customer's loyalty state. */
app.post('/owner/dashboard', async (c) => {
	const blocked = gate(c);
	if (blocked) return blocked;

	let body: { signature?: string };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: 'Invalid JSON body' }, 400);
	}
	if (typeof body.signature !== 'string') return c.json({ error: 'Body must include { signature }' }, 400);

	const message = ownerChallenge(env.groupSafe, todayUtc());
	if (!(await verifySignedBy(env.rpcUrl, env.owner, message, body.signature as Hex)))
		return c.json({ error: 'Owner signature verification failed.' }, 401);

	const { secret, secretDate } = await getDailySecret();
	return c.json({
		secret,
		secretDate,
		stampsPerReward: STAMPS_PER_REWARD,
		customers: allCustomers().map(({ address, customer }) => ({
			address,
			stamps: customer.stamps,
			rewards: customer.rewards
		}))
	});
});

/** Owner marks a customer's free-coffee NFT redeemed. Body: { customer, tokenId, signature }. */
app.post('/redeem', async (c) => {
	const blocked = gate(c);
	if (blocked) return blocked;

	let body: { customer?: string; tokenId?: string; signature?: string };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: 'Invalid JSON body' }, 400);
	}
	const { customer, tokenId, signature } = body;
	if (!customer || !isAddress(customer, { strict: false }))
		return c.json({ error: 'Body must include a valid { customer }' }, 400);
	if (typeof tokenId !== 'string' || typeof signature !== 'string')
		return c.json({ error: 'Body must include { tokenId, signature }' }, 400);

	const addr = getAddress(customer);
	const message = redeemChallenge(addr, tokenId);
	if (!(await verifySignedBy(env.rpcUrl, env.owner, message, signature as Hex)))
		return c.json({ error: 'Owner signature verification failed.' }, 401);

	const ok = await markRedeemed(addr, tokenId);
	if (!ok) return c.json({ error: 'No such reward for that customer.' }, 404);
	return c.json({ redeemed: true, customer: addr, tokenId });
});

await initStore().catch((err) => {
	console.error('[store] init failed, continuing:', err instanceof Error ? err.message : err);
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
	console.log(`coffee-loyalty-backend listening on http://localhost:${info.port}`);
	console.log(`  group Safe:  ${env.groupSafe}`);
	console.log(`  owner:       ${env.owner}`);
	console.log(`  NFT:         ${env.nftContract}`);
	console.log(`  stamps/free: ${STAMPS_PER_REWARD}`);
	console.log(`  origins:     https://${ALLOWED_BASE_DOMAIN} (+ *.${ALLOWED_BASE_DOMAIN})` + (EXTRA_ALLOWED_ORIGINS.length ? `, ${EXTRA_ALLOWED_ORIGINS.join(', ')}` : ''));
});
