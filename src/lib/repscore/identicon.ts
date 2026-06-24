/**
 * Rep Score Explorer — deterministic, dependency-free identicon.
 *
 * Profile images are frequently absent, so every avatar needs a stable fallback
 * derived from its address. We render a GitHub-style 5×5 vertically-mirrored
 * grid as an inline SVG `data:` URI — no network, no `<img>` 404 risk, same
 * address → same art (so it's snapshot-testable).
 */

import type { Address } from './types';

/** FNV-1a 32-bit hash over a string. Deterministic, no crypto dependency. */
function fnv1a(str: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		// h *= 16777619, kept in 32-bit range
		h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
	}
	return h >>> 0;
}

export interface IdenticonCells {
	hue: number;
	cells: boolean[]; // 25 entries, row-major (5×5), vertically mirrored
}

/**
 * Pure: address → stable hue + 5×5 symmetric cell bitmap. Exposed for tests.
 */
export function identiconCells(address: Address): IdenticonCells {
	const seed = address.toLowerCase();
	const hue = fnv1a(seed) % 360;
	// Derive 15 bits (3 columns × 5 rows); mirror columns 0,1 onto 4,3.
	const bits = fnv1a(seed + '/cells');
	const cells: boolean[] = new Array(25).fill(false);
	for (let row = 0; row < 5; row++) {
		for (let col = 0; col < 3; col++) {
			const idx = row * 3 + col;
			const on = ((bits >>> idx) & 1) === 1;
			cells[row * 5 + col] = on;
			cells[row * 5 + (4 - col)] = on; // mirror
		}
	}
	return { hue, cells };
}

/**
 * Deterministic identicon as a `data:image/svg+xml` URI.
 * @param size pixel size of the square (default 100).
 */
export function identiconDataUri(address: Address, size = 100): string {
	const { hue, cells } = identiconCells(address);
	const bg = `hsl(${hue}, 55%, 96%)`;
	const fg = `hsl(${hue}, 62%, 48%)`;
	const cell = size / 5;
	let rects = '';
	for (let i = 0; i < 25; i++) {
		if (!cells[i]) continue;
		const x = (i % 5) * cell;
		const y = Math.floor(i / 5) * cell;
		rects += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}"/>`;
	}
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
		`<rect width="${size}" height="${size}" fill="${bg}"/>` +
		`<g fill="${fg}">${rects}</g>` +
		`</svg>`;
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
