/**
 * Direct Transfer — routing.ts
 *
 * Pure (no-DOM, no-network) logic the miniapp depends on:
 *   - Balance classification (which form is this row?)
 *   - Atto-amount math (2-decimal floor, display-unit conversion)
 *   - Tx encoders (Hub.wrap, safeTransferFrom, wrapper.transfer/unwrap)
 *   - computeRoute(): the priority-driven planner
 *
 * Kept separate from +page.svelte so it's unit-testable in isolation.
 *
 * Conventions:
 *   - Internal canonical unit is "today-atto" (demurraged, == TokenBalance.attoCircles).
 *   - `staticFactor` is "static-atto per 1e18 today-atto" — same number for every
 *     issuer at a given moment, just computed per-issuer for resilience.
 */

// Tx encoding goes through `@aboutcircles/sdk-core`'s typed contract wrappers.
// Each method (`core.hubV2.wrap(...)`, `wrapperInstance.transfer(...)` etc.)
// returns a `TransactionRequest = {to, data, value?}` *without* sending, so
// we can keep building the same batched routes and hand them to the host
// bridge — no hand-rolled calldata, no raw ABI imports.
import {
	Core,
	DemurrageCirclesContract,
	InflationaryCirclesContract
} from '@aboutcircles/sdk-core';
import { circlesConfig } from '@aboutcircles/sdk-utils';

// ─── Types ──────────────────────────────────────────────────
export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type DisplayUnit = 'demurraged' | 'static';
export type TargetForm = 'ERC1155' | 'ERC20_DEM' | 'ERC20_INFL';

export interface BridgeTx {
	to: string;
	data: string;
	value: string;
}

export interface IssuerEntry {
	issuer: Address;
	erc1155: bigint;
	demurraged: { addr: Address; attoCircles: bigint; attoNative: bigint };
	inflationary: { addr: Address; attoCircles: bigint; attoNative: bigint };
	_staticFactor?: bigint;
	_inflPerCrcAtto?: bigint;
}

export interface RouteStep {
	label: string;
	tx: BridgeTx;
}

export interface RoutePlan {
	steps: RouteStep[];
	errors: string[];
	warnings: string[];
}

// ─── Constants ──────────────────────────────────────────────
export const HUB_V2: Address = '0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8';
export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';
export const CIRCLES_TYPE_DEMURRAGE = 0;
export const CIRCLES_TYPE_INFLATION = 1;
export const ATTO_PER_HUNDREDTH = 10n ** 16n; // 0.01 CRC in atto
export const ONE_CRC_ATTO = 10n ** 18n;
// Tolerance for "amount == balance" comparisons. Routing rounds amounts to
// the 0.01 CRC step before sending, so 1000 wei of slop is plenty.
export const DUST_TOLERANCE_ATTO = 1000n;

// ─── Atto math ──────────────────────────────────────────────
export function floorAttoTo2Decimals(atto: bigint): bigint {
	if (atto <= 0n) return 0n;
	return (atto / ATTO_PER_HUNDREDTH) * ATTO_PER_HUNDREDTH;
}

/**
 * Convert today-demurraged-atto to the user-visible unit.
 *   unit === 'demurraged' → identity
 *   unit === 'static'     → multiply by staticFactor / 1e18
 * staticFactor === 0n is treated as "unknown" and falls back to identity so
 * the display can't silently produce nonsense.
 */
export function toDisplayAtto(
	todayAtto: bigint,
	staticFactor: bigint | undefined | null,
	unit: DisplayUnit
): bigint {
	if (unit !== 'static') return todayAtto;
	if (!staticFactor || staticFactor === 0n) return todayAtto;
	return (todayAtto * staticFactor) / ONE_CRC_ATTO;
}

/** Inverse of toDisplayAtto. */
export function fromDisplayAtto(
	displayAtto: bigint,
	staticFactor: bigint | undefined | null,
	unit: DisplayUnit
): bigint {
	if (unit !== 'static') return displayAtto;
	if (!staticFactor || staticFactor === 0n) return displayAtto;
	return (displayAtto * ONE_CRC_ATTO) / staticFactor;
}

// ─── Balance row classification ─────────────────────────────
export interface TokenBalanceLike {
	isErc1155?: boolean;
	isErc20?: boolean;
	isWrapped?: boolean;
	isInflationary?: boolean;
}

/**
 * Classify a TokenBalance row into a form we know how to handle.
 * Returns: 'erc1155' | 'demurraged' | 'inflationary' | null
 * v1 ERC20 personal tokens (isErc20 && !isWrapped) are out of scope.
 */
export function classifyBalance(
	b: TokenBalanceLike | null | undefined
): 'erc1155' | 'demurraged' | 'inflationary' | null {
	if (b?.isErc1155 && !b.isWrapped) return 'erc1155';
	if (b?.isErc20 && b.isWrapped && !b.isInflationary) return 'demurraged';
	if (b?.isErc20 && b.isWrapped && b.isInflationary) return 'inflationary';
	return null;
}

// ─── SDK contract instances (lazy, cached) ──────────────────
// `circlesConfig[100]` is Gnosis Chain mainnet. We pass `rpcUrl` to wrapper
// instances even though we never call their read methods here — only the
// tx-building methods, which don't touch the network. The URL is required by
// the constructor signature.
let _core: Core | null = null;
function getCore(): Core {
	if (!_core) _core = new Core(circlesConfig[100]);
	return _core;
}
const _demCache = new Map<string, DemurrageCirclesContract>();
const _inflCache = new Map<string, InflationaryCirclesContract>();
function getDemurrageContract(addr: Address): DemurrageCirclesContract {
	const k = addr.toLowerCase();
	if (!_demCache.has(k)) {
		_demCache.set(
			k,
			new DemurrageCirclesContract({ address: addr, rpcUrl: circlesConfig[100].circlesRpcUrl })
		);
	}
	return _demCache.get(k)!;
}
function getInflationaryContract(addr: Address): InflationaryCirclesContract {
	const k = addr.toLowerCase();
	if (!_inflCache.has(k)) {
		_inflCache.set(
			k,
			new InflationaryCirclesContract({ address: addr, rpcUrl: circlesConfig[100].circlesRpcUrl })
		);
	}
	return _inflCache.get(k)!;
}

// `TransactionRequest` from the SDK has `value?: bigint`. The miniapp host
// bridge expects `value` as a hex string. Serialize at the edge.
function toBridgeTx(req: { to: Address; data: Hex; value?: bigint }): BridgeTx {
	return {
		to: req.to,
		data: req.data,
		value: req.value == null ? '0x0' : `0x${BigInt(req.value).toString(16)}`
	};
}

// ─── Tx encoders (SDK-typed under the hood) ─────────────────
export function makeSafeTransfer1155(opts: {
	from: Address;
	to: Address;
	tokenId: bigint;
	atto: bigint;
}): BridgeTx {
	return toBridgeTx(
		getCore().hubV2.safeTransferFrom(opts.from, opts.to, opts.tokenId, opts.atto, '0x')
	);
}

export function makeHubWrap(opts: { issuer: Address; atto: bigint; typeEnum: number }): BridgeTx {
	return toBridgeTx(getCore().hubV2.wrap(opts.issuer, opts.atto, opts.typeEnum));
}

export function makeUnwrapDem(opts: { wrapperAddr: Address; atto: bigint }): BridgeTx {
	return toBridgeTx(getDemurrageContract(opts.wrapperAddr).unwrap(opts.atto));
}

export function makeUnwrapInfl(opts: { wrapperAddr: Address; nativeAtto: bigint }): BridgeTx {
	return toBridgeTx(getInflationaryContract(opts.wrapperAddr).unwrap(opts.nativeAtto));
}

export function makeDemTransfer(opts: {
	wrapperAddr: Address;
	to: Address;
	atto: bigint;
}): BridgeTx {
	return toBridgeTx(getDemurrageContract(opts.wrapperAddr).transfer(opts.to, opts.atto));
}

export function makeInflTransfer(opts: {
	wrapperAddr: Address;
	to: Address;
	nativeAtto: bigint;
}): BridgeTx {
	return toBridgeTx(getInflationaryContract(opts.wrapperAddr).transfer(opts.to, opts.nativeAtto));
}

// ─── Conversion ─────────────────────────────────────────────
/**
 * Convert today-atto → inflationary native atto.
 * Prefers an on-chain ratio if available; falls back to the indexer-derived
 * staticFactor. Returns null if no factor is available.
 */
export function todayToInflNative(
	todayAtto: bigint,
	{ inflPerCrcAtto, staticFactor }: { inflPerCrcAtto?: bigint; staticFactor?: bigint }
): bigint | null {
	const factor =
		inflPerCrcAtto && inflPerCrcAtto > 0n
			? inflPerCrcAtto
			: staticFactor && staticFactor > 0n
				? staticFactor
				: null;
	if (!factor) return null;
	return (todayAtto * factor) / ONE_CRC_ATTO;
}

// ─── Route planner ──────────────────────────────────────────
/**
 * Plan the minimal tx batch to send `amountAtto` to `recipient` in `targetForm`.
 *
 * Priority (encoded in the order we drain pools):
 *   ERC1155     : existing → demurraged unwrap → inflationary unwrap
 *   ERC20_DEM   : existing → wrap from 1155   → unwrap infl + wrap dem
 *   ERC20_INFL  : existing → wrap from 1155   → unwrap dem + wrap infl
 *
 * This matches the user-stated rule: prefer wrap-from-1155 over rewrap, and
 * keep wrapped balances wrapped unless we must unwrap to satisfy the request.
 */
export interface ComputeRouteInput {
	entry: IssuerEntry | null;
	amountAtto: bigint | null;
	targetForm: TargetForm;
	recipient: Address | null;
	fromAddress: Address;
}

export function computeRoute({
	entry,
	amountAtto,
	targetForm,
	recipient,
	fromAddress
}: ComputeRouteInput): RoutePlan {
	const result: RoutePlan = { steps: [], errors: [], warnings: [] };
	if (!entry) {
		result.errors.push('No token selected.');
		return result;
	}
	if (!recipient) {
		result.errors.push('Pick a recipient.');
		return result;
	}
	if (amountAtto == null) {
		result.errors.push('Enter an amount.');
		return result;
	}
	if (amountAtto === 0n) {
		result.errors.push('Amount must be greater than zero.');
		return result;
	}

	const issuer = entry.issuer;
	const tokenId = BigInt(issuer); // Hub V2 tokenId == uint256(uint160(avatar))
	const b1155 = entry.erc1155;
	const bDem = entry.demurraged.attoCircles;
	const bInfl = entry.inflationary.attoCircles;
	const demAddr = entry.demurraged.addr;
	const inflAddr = entry.inflationary.addr;

	const totalAvail = b1155 + bDem + bInfl;
	if (amountAtto > totalAvail + DUST_TOLERANCE_ATTO) {
		result.errors.push(`Not enough Circles. You have ${totalAvail} atto across all forms.`);
		return result;
	}

	// Drain pools in priority order.
	let remaining = amountAtto;
	const drain = (avail: bigint): bigint => {
		if (remaining <= 0n || avail <= 0n) return 0n;
		const used = avail >= remaining ? remaining : avail;
		remaining -= used;
		return used;
	};
	let use1155 = 0n;
	let useDem = 0n;
	let useInfl = 0n;

	if (targetForm === 'ERC1155') {
		use1155 = drain(b1155);
		useDem = drain(bDem);
		useInfl = drain(bInfl);
	} else if (targetForm === 'ERC20_DEM') {
		useDem = drain(bDem);
		use1155 = drain(b1155);
		useInfl = drain(bInfl);
	} else if (targetForm === 'ERC20_INFL') {
		useInfl = drain(bInfl);
		use1155 = drain(b1155);
		useDem = drain(bDem);
	} else {
		result.errors.push('Unknown target form.');
		return result;
	}

	if (remaining > DUST_TOLERANCE_ATTO) {
		result.errors.push(`Not enough Circles. You have ${totalAvail} atto across all forms.`);
		return result;
	}

	// Wrapper-deploy preconditions. Hub.wrap deploys the wrapper if absent, but
	// any tx in the same batch that targets the wrapper needs its address up
	// front — we can't predict CREATE2 output here.
	if (useInfl > 0n && inflAddr === ZERO_ADDRESS) {
		result.errors.push("Inflationary wrapper not deployed; can't draw from it.");
		return result;
	}
	if (targetForm === 'ERC20_DEM' && (use1155 > 0n || useInfl > 0n) && demAddr === ZERO_ADDRESS) {
		result.errors.push(
			'Demurraged wrapper not yet deployed. Wrap once via the Circles app, then come back.'
		);
		return result;
	}
	if (targetForm === 'ERC20_INFL' && (use1155 > 0n || useDem > 0n) && inflAddr === ZERO_ADDRESS) {
		result.errors.push(
			'Inflationary wrapper not yet deployed. Wrap once via the Circles app, then come back.'
		);
		return result;
	}
	const conv = { inflPerCrcAtto: entry._inflPerCrcAtto, staticFactor: entry._staticFactor };
	const inflFactorReady =
		(conv.inflPerCrcAtto && conv.inflPerCrcAtto > 0n) ||
		(conv.staticFactor && conv.staticFactor > 0n);
	if ((targetForm === 'ERC20_INFL' || useInfl > 0n) && !inflFactorReady) {
		result.errors.push('Loading inflationary conversion ratio… try again in a moment.');
		return result;
	}

	// Build tx batch.
	if (targetForm === 'ERC1155') {
		if (useDem > 0n) {
			result.steps.push({
				label: `Unwrap ${useDem} atto from demurraged → ERC1155`,
				tx: makeUnwrapDem({ wrapperAddr: demAddr, atto: useDem })
			});
		}
		if (useInfl > 0n) {
			const native = todayToInflNative(useInfl, conv)!;
			result.steps.push({
				label: `Unwrap ${useInfl} atto from inflationary → ERC1155`,
				tx: makeUnwrapInfl({ wrapperAddr: inflAddr, nativeAtto: native })
			});
		}
		result.steps.push({
			label: `Send ${amountAtto} atto as ERC1155 to ${recipient}`,
			tx: makeSafeTransfer1155({ from: fromAddress, to: recipient, tokenId, atto: amountAtto })
		});
		return result;
	}

	if (targetForm === 'ERC20_DEM') {
		if (useInfl > 0n) {
			const native = todayToInflNative(useInfl, conv)!;
			result.steps.push({
				label: `Unwrap ${useInfl} atto from inflationary → ERC1155`,
				tx: makeUnwrapInfl({ wrapperAddr: inflAddr, nativeAtto: native })
			});
		}
		const toWrap = use1155 + useInfl;
		if (toWrap > 0n) {
			result.steps.push({
				label: `Wrap ${toWrap} atto ERC1155 → Demurraged ERC20`,
				tx: makeHubWrap({ issuer, atto: toWrap, typeEnum: CIRCLES_TYPE_DEMURRAGE })
			});
		}
		result.steps.push({
			label: `Send ${amountAtto} atto as Demurraged ERC20 to ${recipient}`,
			tx: makeDemTransfer({ wrapperAddr: demAddr, to: recipient, atto: amountAtto })
		});
		return result;
	}

	// targetForm === 'ERC20_INFL'
	if (useDem > 0n) {
		result.steps.push({
			label: `Unwrap ${useDem} atto from demurraged → ERC1155`,
			tx: makeUnwrapDem({ wrapperAddr: demAddr, atto: useDem })
		});
	}
	const toWrap = use1155 + useDem;
	if (toWrap > 0n) {
		result.steps.push({
			label: `Wrap ${toWrap} atto ERC1155 → Inflationary ERC20`,
			tx: makeHubWrap({ issuer, atto: toWrap, typeEnum: CIRCLES_TYPE_INFLATION })
		});
	}
	let nativeToSend = todayToInflNative(amountAtto, conv)!;
	// Cap to actual post-wrap balance so a tiny ratio mismatch can't over-spend.
	const wrapNative = toWrap > 0n ? todayToInflNative(toWrap, conv) : 0n;
	const havePostWrap = entry.inflationary.attoNative + (wrapNative ?? 0n);
	if (nativeToSend > havePostWrap) nativeToSend = havePostWrap;
	result.steps.push({
		label: `Send ${amountAtto} atto as Inflationary ERC20 to ${recipient}`,
		tx: makeInflTransfer({ wrapperAddr: inflAddr, to: recipient, nativeAtto: nativeToSend })
	});
	return result;
}
