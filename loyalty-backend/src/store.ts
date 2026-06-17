/**
 * Loyalty state, persisted to a simple JSON file (no database) — same approach as
 * the invite-backend's stats.ts: read at boot, rewrite on each mutation, writes
 * serialised so concurrent requests can't clobber the file.
 *
 * Path is STORE_FILE (default ./data/loyalty.json next to the service).
 *
 * Shape:
 * {
 *   secret, secretDate,            // the daily QR secret + the day it belongs to
 *   customers: {
 *     "0xabc…": {
 *       stamps,                    // current stamps toward the next free coffee
 *       lastStampDate,            // YYYY-MM-DD of the last stamp (one per day)
 *       joinedGroup,              // has the group already trusted this customer
 *       rewards: [{ tokenId, mintedAt, txHash, redeemed }]
 *     }
 *   }
 * }
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { getAddress, type Address } from 'viem';

/** Stamps required to earn one free coffee. */
export const STAMPS_PER_REWARD = 10;

const STORE_FILE = resolve(process.env.STORE_FILE ?? './data/loyalty.json');

export interface Reward {
	tokenId: string;
	mintedAt: string;
	txHash: string;
	redeemed: boolean;
}

export interface Customer {
	stamps: number;
	lastStampDate: string | null;
	joinedGroup: boolean;
	rewards: Reward[];
}

interface StoreFile {
	secret: string;
	secretDate: string; // YYYY-MM-DD
	customers: Record<string, Customer>;
}

let store: StoreFile = { secret: '', secretDate: '', customers: {} };
let writing: Promise<void> = Promise.resolve();

/** Today's date as YYYY-MM-DD in UTC — the unit the daily secret rotates on. */
export function todayUtc(): string {
	return new Date().toISOString().slice(0, 10);
}

function freshSecret(): string {
	return randomBytes(16).toString('hex');
}

function emptyCustomer(): Customer {
	return { stamps: 0, lastStampDate: null, joinedGroup: false, rewards: [] };
}

/** Normalise an address to its checksummed form for use as a store key. */
export function key(address: Address | string): Address {
	return getAddress(address);
}

/** Load the store at boot (creates one, with today's secret, if missing). */
export async function initStore(): Promise<void> {
	try {
		const raw = await readFile(STORE_FILE, 'utf8');
		const parsed = JSON.parse(raw) as Partial<StoreFile>;
		store = {
			secret: parsed.secret ?? freshSecret(),
			secretDate: parsed.secretDate ?? todayUtc(),
			customers: parsed.customers ?? {}
		};
	} catch {
		store = { secret: freshSecret(), secretDate: todayUtc(), customers: {} };
	}
	// Rotate immediately so a stale on-disk secret never gets served.
	rotateSecretIfStale();
	await persist().catch(() => {});
}

async function persist(): Promise<void> {
	await mkdir(dirname(STORE_FILE), { recursive: true });
	await writeFile(STORE_FILE, JSON.stringify(store, null, 2));
}

/** Queue a write so concurrent mutations serialise rather than racing the file. */
function scheduleWrite(): Promise<void> {
	writing = writing.then(() => persist()).catch((err) => {
		console.error('[store] persist failed:', err instanceof Error ? err.message : err);
	});
	return writing;
}

/** Roll the daily secret if the stored one belongs to an earlier day. */
function rotateSecretIfStale(): void {
	const today = todayUtc();
	if (store.secretDate !== today || !store.secret) {
		store.secret = freshSecret();
		store.secretDate = today;
	}
}

/** Current daily secret, rotating (and persisting) first if it's stale. */
export async function getDailySecret(): Promise<{ secret: string; secretDate: string }> {
	const before = store.secret;
	rotateSecretIfStale();
	if (store.secret !== before) await scheduleWrite();
	return { secret: store.secret, secretDate: store.secretDate };
}

/** Validate a secret submitted with a stamp request against today's secret. */
export async function isCurrentSecret(secret: string): Promise<boolean> {
	const { secret: current } = await getDailySecret();
	// Constant-time-ish compare; lengths are equal for valid hex secrets.
	if (typeof secret !== 'string' || secret.length !== current.length) return false;
	let diff = 0;
	for (let i = 0; i < current.length; i++) diff |= secret.charCodeAt(i) ^ current.charCodeAt(i);
	return diff === 0;
}

export function getCustomer(address: Address): Customer {
	return store.customers[key(address)] ?? emptyCustomer();
}

/** Has this customer already collected a stamp today? */
export function stampedToday(address: Address): boolean {
	return getCustomer(address).lastStampDate === todayUtc();
}

/** Mark a customer as trusted into the group (so we skip the trust tx next time). */
export async function markJoined(address: Address): Promise<void> {
	const k = key(address);
	const c = store.customers[k] ?? emptyCustomer();
	c.joinedGroup = true;
	store.customers[k] = c;
	await scheduleWrite();
}

/**
 * Add one stamp for `address` (caller must have checked stampedToday()).
 * Returns the updated customer record. Does NOT reset on reaching the reward
 * threshold — addReward() does that, after the NFT actually mints.
 */
export async function addStamp(address: Address): Promise<Customer> {
	const k = key(address);
	const c = store.customers[k] ?? emptyCustomer();
	c.stamps += 1;
	c.lastStampDate = todayUtc();
	store.customers[k] = c;
	await scheduleWrite();
	return c;
}

/** Record a freshly-minted reward and reset the customer's stamp counter. */
export async function addReward(address: Address, reward: Reward): Promise<Customer> {
	const k = key(address);
	const c = store.customers[k] ?? emptyCustomer();
	c.rewards.push(reward);
	c.stamps = 0;
	store.customers[k] = c;
	await scheduleWrite();
	return c;
}

/** Flip a reward to redeemed. Returns false if the token wasn't found. */
export async function markRedeemed(address: Address, tokenId: string): Promise<boolean> {
	const c = store.customers[key(address)];
	const reward = c?.rewards.find((r) => r.tokenId === tokenId);
	if (!reward) return false;
	reward.redeemed = true;
	await scheduleWrite();
	return true;
}

/** All customers (checksummed address + record), for the owner dashboard. */
export function allCustomers(): Array<{ address: Address; customer: Customer }> {
	return Object.entries(store.customers).map(([address, customer]) => ({
		address: address as Address,
		customer
	}));
}
