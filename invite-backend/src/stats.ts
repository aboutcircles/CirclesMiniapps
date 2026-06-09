/**
 * Per-app signup attribution, persisted to a simple JSON file.
 *
 * No database — just a JSON file we read at boot and rewrite on each new signup.
 * The file holds per-app counts and is served verbatim at GET /stats.
 *
 * Path is STATS_FILE (default ./data/stats.json next to the service).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const STATS_FILE = resolve(process.env.STATS_FILE ?? './data/stats.json');

export interface StatsFile {
	/** ISO timestamp of the last update. */
	updatedAt: string | null;
	/** Total signups recorded. */
	total: number;
	/** signups per app, keyed by app id (miniapp origin, or "direct"). */
	byApp: Record<string, { count: number; lastAt: string }>;
}

let stats: StatsFile = { updatedAt: null, total: 0, byApp: {} };
let writing: Promise<void> = Promise.resolve();

/** Load the stats file at boot (creates an empty one if missing). */
export async function initStats(): Promise<void> {
	try {
		const raw = await readFile(STATS_FILE, 'utf8');
		const parsed = JSON.parse(raw) as Partial<StatsFile>;
		stats = {
			updatedAt: parsed.updatedAt ?? null,
			total: parsed.total ?? 0,
			byApp: parsed.byApp ?? {}
		};
		console.log(`[stats] loaded ${STATS_FILE} (${stats.total} signups across ${Object.keys(stats.byApp).length} apps)`);
	} catch {
		// Missing/invalid → start fresh and write an empty file.
		stats = { updatedAt: null, total: 0, byApp: {} };
		await persist().catch(() => {});
		console.log(`[stats] initialised new ${STATS_FILE}`);
	}
}

async function persist(): Promise<void> {
	await mkdir(dirname(STATS_FILE), { recursive: true });
	await writeFile(STATS_FILE, JSON.stringify(stats, null, 2));
}

/** Record one successful signup for `app`. Never throws (logs on failure). */
export async function recordSignup(app: string, isoNow: string): Promise<void> {
	const entry = stats.byApp[app] ?? { count: 0, lastAt: isoNow };
	entry.count += 1;
	entry.lastAt = isoNow;
	stats.byApp[app] = entry;
	stats.total += 1;
	stats.updatedAt = isoNow;
	// Serialise writes so concurrent signups don't clobber the file.
	writing = writing.then(() => persist()).catch((err) => {
		console.error('[stats] persist failed:', err instanceof Error ? err.message : err);
	});
	await writing;
}

/** Current stats as a plain object, with byApp sorted busiest-first. */
export function getStats(): StatsFile & { byAppSorted: Array<{ app: string; count: number; lastAt: string }> } {
	const byAppSorted = Object.entries(stats.byApp)
		.map(([app, v]) => ({ app, count: v.count, lastAt: v.lastAt }))
		.sort((a, b) => b.count - a.count);
	return { ...stats, byAppSorted };
}
