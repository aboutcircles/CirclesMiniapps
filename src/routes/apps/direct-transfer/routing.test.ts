// Test fixtures intentionally pass through viem's `decodeFunctionData` whose
// return type is a wide union (one tuple per ABI function). Narrowing every
// arg access by hand bloats the suite without catching real bugs — the tests
// already discriminate via `expect(decoded.functionName).toBe(...)`. Skip
// type-checking this file; vitest still runs it normally.
// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { decodeFunctionData } from 'viem';
import { hubV2Abi } from '@aboutcircles/sdk-abis/hubV2';
import { demurrageCirclesAbi } from '@aboutcircles/sdk-abis/demurrageCircles';
import { inflationaryCirclesAbi } from '@aboutcircles/sdk-abis/inflationaryCircles';

import {
  HUB_V2,
  ZERO_ADDRESS,
  ATTO_PER_HUNDREDTH,
  ONE_CRC_ATTO,
  CIRCLES_TYPE_DEMURRAGE,
  CIRCLES_TYPE_INFLATION,
  floorAttoTo2Decimals,
  classifyBalance,
  toDisplayAtto,
  fromDisplayAtto,
  todayToInflNative,
  makeSafeTransfer1155,
  makeHubWrap,
  makeUnwrapDem,
  makeUnwrapInfl,
  makeDemTransfer,
  makeInflTransfer,
  computeRoute,
  type Address,
  type IssuerEntry,
  type ComputeRouteInput,
  type TargetForm,
  type DisplayUnit,
} from './routing';

// ─── Test fixtures ──────────────────────────────────────────
const FROM: Address = '0xf48554937f18885c7f15c432c596b5843648231D';
const RECIPIENT: Address = '0x000000000000000000000000000000000000beef';
const ISSUER: Address = '0x1111111111111111111111111111111111111111';
const DEM_WRAPPER: Address = '0x2222222222222222222222222222222222222222';
const INFL_WRAPPER: Address = '0x3333333333333333333333333333333333333333';

// All TokenBalance rows for the same issuer share today, so the static factor
// is the same across rows. Pick a non-trivial ratio so tests catch unit bugs:
// 1 today-CRC == 1.25 static-CRC.
const STATIC_FACTOR = (10n ** 18n * 125n) / 100n; // 1.25e18

interface MakeEntryOpts {
  erc1155?: bigint;
  dem?: bigint;
  infl?: bigint;
  inflNative?: bigint | null;
  demAddr?: Address;
  inflAddr?: Address;
  staticFactor?: bigint;
}

function makeEntry({
  erc1155 = 0n,
  dem = 0n,
  infl = 0n,
  inflNative = null,
  demAddr = DEM_WRAPPER,
  inflAddr = INFL_WRAPPER,
  staticFactor = STATIC_FACTOR,
}: MakeEntryOpts = {}): IssuerEntry {
  const native =
    inflNative != null ? inflNative : (infl * STATIC_FACTOR) / ONE_CRC_ATTO;
  return {
    issuer: ISSUER,
    erc1155,
    demurraged: { addr: demAddr, attoCircles: dem, attoNative: dem },
    inflationary: { addr: inflAddr, attoCircles: infl, attoNative: native },
    _staticFactor: staticFactor,
  };
}

interface PlanArgs {
  entry: IssuerEntry | null;
  amountAtto: bigint | null;
  targetForm: TargetForm | string;
  recipient?: Address | null;
  fromAddress?: Address;
}

function plan(args: PlanArgs) {
  // Use `in` checks so callers can pass `recipient: null` explicitly to test
  // the "missing recipient" branch — `??` would silently replace it.
  return computeRoute({
    entry: args.entry,
    amountAtto: args.amountAtto,
    targetForm: args.targetForm as TargetForm,
    recipient: 'recipient' in args ? (args.recipient ?? null) : RECIPIENT,
    fromAddress: 'fromAddress' in args ? args.fromAddress! : FROM,
  });
}

// ─── floorAttoTo2Decimals ───────────────────────────────────
describe('floorAttoTo2Decimals', () => {
  it('floors to 0.01 CRC granularity', () => {
    expect(floorAttoTo2Decimals(123_456_789_000_000_000n)).toBe(120_000_000_000_000_000n); // 0.12
    expect(floorAttoTo2Decimals(100_000_000_000_000_000n)).toBe(100_000_000_000_000_000n); // 0.10
    expect(floorAttoTo2Decimals(99_999_999_999_999n)).toBe(0n); // sub-0.01 → 0
  });
  it('handles zero and negatives', () => {
    expect(floorAttoTo2Decimals(0n)).toBe(0n);
    expect(floorAttoTo2Decimals(-1n)).toBe(0n);
  });
  it('is idempotent on already-floored values', () => {
    const v = 5n * ATTO_PER_HUNDREDTH;
    expect(floorAttoTo2Decimals(v)).toBe(v);
  });
});

// ─── classifyBalance ────────────────────────────────────────
describe('classifyBalance', () => {
  it('identifies ERC1155 native', () => {
    expect(classifyBalance({ isErc1155: true, isWrapped: false })).toBe('erc1155');
  });
  it('identifies demurraged wrapper', () => {
    expect(classifyBalance({ isErc20: true, isWrapped: true, isInflationary: false })).toBe('demurraged');
  });
  it('identifies inflationary wrapper', () => {
    expect(classifyBalance({ isErc20: true, isWrapped: true, isInflationary: true })).toBe('inflationary');
  });
  it('rejects v1 ERC20 personal tokens (unwrapped ERC20)', () => {
    expect(classifyBalance({ isErc20: true, isWrapped: false })).toBeNull();
  });
  it('handles nullish input safely', () => {
    expect(classifyBalance(null)).toBeNull();
    expect(classifyBalance(undefined)).toBeNull();
    expect(classifyBalance({})).toBeNull();
  });
});

// ─── toDisplayAtto / fromDisplayAtto ────────────────────────
describe('toDisplayAtto / fromDisplayAtto', () => {
  it('demurraged mode is identity', () => {
    expect(toDisplayAtto(123n, STATIC_FACTOR, 'demurraged')).toBe(123n);
    expect(fromDisplayAtto(123n, STATIC_FACTOR, 'demurraged')).toBe(123n);
  });
  it('static mode applies the factor', () => {
    // 1 CRC today * factor (1.25e18) / 1e18 = 1.25 static
    const oneCrc = ONE_CRC_ATTO;
    expect(toDisplayAtto(oneCrc, STATIC_FACTOR, 'static')).toBe((125n * oneCrc) / 100n);
  });
  it('round-trips static → demurraged → static (modulo bigint rounding)', () => {
    const start = 12_345_000_000_000_000n; // 0.012345 CRC today
    const display = toDisplayAtto(start, STATIC_FACTOR, 'static');
    const back = fromDisplayAtto(display, STATIC_FACTOR, 'static');
    // Allow 1 atto rounding (bigint floor) — display is many orders of magnitude away from 1 atto.
    expect(back >= start - 1n && back <= start).toBe(true);
  });
  it('falls back to identity when factor is 0/missing', () => {
    expect(toDisplayAtto(99n, 0n, 'static')).toBe(99n);
    expect(toDisplayAtto(99n, undefined, 'static')).toBe(99n);
  });
});

// ─── todayToInflNative ──────────────────────────────────────
describe('todayToInflNative', () => {
  it('prefers inflPerCrcAtto over staticFactor', () => {
    const v = todayToInflNative(ONE_CRC_ATTO, {
      inflPerCrcAtto: 2n * ONE_CRC_ATTO,
      staticFactor: STATIC_FACTOR,
    });
    expect(v).toBe(2n * ONE_CRC_ATTO);
  });
  it('falls back to staticFactor when inflPerCrcAtto missing', () => {
    const v = todayToInflNative(ONE_CRC_ATTO, { staticFactor: STATIC_FACTOR });
    expect(v).toBe(STATIC_FACTOR);
  });
  it('returns null when no factor is known', () => {
    expect(todayToInflNative(ONE_CRC_ATTO, {})).toBeNull();
    expect(todayToInflNative(ONE_CRC_ATTO, { staticFactor: 0n })).toBeNull();
  });
});

// ─── Tx encoders ────────────────────────────────────────────
describe('tx encoders', () => {
  it('makeSafeTransfer1155 produces decodable Hub.safeTransferFrom calldata', () => {
    const tx = makeSafeTransfer1155({
      from: FROM,
      to: RECIPIENT,
      tokenId: BigInt(ISSUER),
      atto: 5n * ONE_CRC_ATTO,
    });
    expect(tx.to.toLowerCase()).toBe(HUB_V2.toLowerCase());
    expect(tx.value).toBe('0x0');
    const decoded = decodeFunctionData({ abi: hubV2Abi, data: tx.data });
    expect(decoded.functionName).toBe('safeTransferFrom');
    expect(decoded.args[0].toLowerCase()).toBe(FROM.toLowerCase());
    expect(decoded.args[1].toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(decoded.args[2]).toBe(BigInt(ISSUER));
    expect(decoded.args[3]).toBe(5n * ONE_CRC_ATTO);
  });

  it('makeHubWrap encodes the type enum (Demurrage=0, Inflation=1)', () => {
    const a = makeHubWrap({ issuer: ISSUER, atto: ONE_CRC_ATTO, typeEnum: CIRCLES_TYPE_DEMURRAGE });
    const b = makeHubWrap({ issuer: ISSUER, atto: ONE_CRC_ATTO, typeEnum: CIRCLES_TYPE_INFLATION });
    expect(decodeFunctionData({ abi: hubV2Abi, data: a.data }).args[2]).toBe(0);
    expect(decodeFunctionData({ abi: hubV2Abi, data: b.data }).args[2]).toBe(1);
  });

  it('wrapper transfer/unwrap target the wrapper address', () => {
    const t = makeDemTransfer({ wrapperAddr: DEM_WRAPPER, to: RECIPIENT, atto: 1n });
    expect(t.to).toBe(DEM_WRAPPER);
    const decoded = decodeFunctionData({ abi: demurrageCirclesAbi, data: t.data });
    expect(decoded.functionName).toBe('transfer');

    const u = makeUnwrapInfl({ wrapperAddr: INFL_WRAPPER, nativeAtto: 7n });
    expect(u.to).toBe(INFL_WRAPPER);
    const ud = decodeFunctionData({ abi: inflationaryCirclesAbi, data: u.data });
    expect(ud.functionName).toBe('unwrap');
    expect(ud.args[0]).toBe(7n);
  });
});

// ─── computeRoute: input validation ─────────────────────────
describe('computeRoute: input validation', () => {
  it('errors when no entry', () => {
    expect(plan({ entry: null, amountAtto: 1n, targetForm: 'ERC1155' }).errors).toContain(
      'No token selected.'
    );
  });
  it('errors when no recipient', () => {
    expect(
      plan({ entry: makeEntry({ erc1155: ONE_CRC_ATTO }), amountAtto: 1n, targetForm: 'ERC1155', recipient: null }).errors
    ).toContain('Pick a recipient.');
  });
  it('errors when amount missing', () => {
    expect(plan({ entry: makeEntry({}), amountAtto: null, targetForm: 'ERC1155' }).errors).toContain(
      'Enter an amount.'
    );
  });
  it('errors when amount is zero', () => {
    expect(plan({ entry: makeEntry({}), amountAtto: 0n, targetForm: 'ERC1155' }).errors).toContain(
      'Amount must be greater than zero.'
    );
  });
  it('errors when target form is unrecognised', () => {
    expect(
      plan({ entry: makeEntry({ erc1155: ONE_CRC_ATTO }), amountAtto: 1n, targetForm: 'NONSENSE' }).errors
    ).toContain('Unknown target form.');
  });
});

// ─── computeRoute: ERC1155 target ───────────────────────────
describe('computeRoute: target=ERC1155', () => {
  it('single-tx safeTransfer when ERC1155 balance is enough (no wrap/unwrap)', () => {
    const r = plan({
      entry: makeEntry({ erc1155: 10n * ONE_CRC_ATTO, dem: 10n * ONE_CRC_ATTO, infl: 10n * ONE_CRC_ATTO }),
      amountAtto: 5n * ONE_CRC_ATTO,
      targetForm: 'ERC1155',
    });
    expect(r.errors).toEqual([]);
    expect(r.steps).toHaveLength(1);
    expect(decodeFunctionData({ abi: hubV2Abi, data: r.steps[0].tx.data }).functionName).toBe('safeTransferFrom');
  });

  it('prefers unwrapping demurraged (1:1) over inflationary when topping up', () => {
    const r = plan({
      entry: makeEntry({ erc1155: 1n * ONE_CRC_ATTO, dem: 5n * ONE_CRC_ATTO, infl: 5n * ONE_CRC_ATTO }),
      amountAtto: 3n * ONE_CRC_ATTO,
      targetForm: 'ERC1155',
    });
    expect(r.errors).toEqual([]);
    // 1 ERC1155 + 2 from dem; should NOT touch inflationary.
    expect(r.steps).toHaveLength(2);
    const [unwrap, send] = r.steps;
    const unwrapDecoded = decodeFunctionData({ abi: demurrageCirclesAbi, data: unwrap.tx.data });
    expect(unwrapDecoded.functionName).toBe('unwrap');
    expect(unwrapDecoded.args[0]).toBe(2n * ONE_CRC_ATTO);
    expect(decodeFunctionData({ abi: hubV2Abi, data: send.tx.data }).functionName).toBe('safeTransferFrom');
  });

  it('falls through to inflationary when 1155 + dem are not enough', () => {
    const r = plan({
      entry: makeEntry({ erc1155: 1n * ONE_CRC_ATTO, dem: 1n * ONE_CRC_ATTO, infl: 10n * ONE_CRC_ATTO }),
      amountAtto: 3n * ONE_CRC_ATTO,
      targetForm: 'ERC1155',
    });
    expect(r.errors).toEqual([]);
    // unwrap-dem (1) → unwrap-infl (1) → send (3)
    expect(r.steps).toHaveLength(3);
    expect(decodeFunctionData({ abi: demurrageCirclesAbi, data: r.steps[0].tx.data }).functionName).toBe('unwrap');
    expect(decodeFunctionData({ abi: inflationaryCirclesAbi, data: r.steps[1].tx.data }).functionName).toBe('unwrap');
    expect(decodeFunctionData({ abi: hubV2Abi, data: r.steps[2].tx.data }).functionName).toBe('safeTransferFrom');
  });

  it('errors when the total across all forms is insufficient', () => {
    const r = plan({
      entry: makeEntry({ erc1155: 1n, dem: 1n, infl: 1n }),
      amountAtto: ONE_CRC_ATTO,
      targetForm: 'ERC1155',
    });
    expect(r.steps).toEqual([]);
    expect(r.errors[0]).toMatch(/Not enough Circles/);
  });
});

// ─── computeRoute: ERC20_DEM target ─────────────────────────
describe('computeRoute: target=ERC20_DEM', () => {
  it('single-tx wrapper.transfer when demurraged balance is enough', () => {
    const r = plan({
      entry: makeEntry({ erc1155: 0n, dem: 10n * ONE_CRC_ATTO }),
      amountAtto: 3n * ONE_CRC_ATTO,
      targetForm: 'ERC20_DEM',
    });
    expect(r.errors).toEqual([]);
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0].tx.to).toBe(DEM_WRAPPER);
    expect(decodeFunctionData({ abi: demurrageCirclesAbi, data: r.steps[0].tx.data }).functionName).toBe('transfer');
  });

  it('prefers wrapping from ERC1155 over rewrapping from inflationary', () => {
    const r = plan({
      entry: makeEntry({ erc1155: 5n * ONE_CRC_ATTO, dem: 0n, infl: 5n * ONE_CRC_ATTO }),
      amountAtto: 3n * ONE_CRC_ATTO,
      targetForm: 'ERC20_DEM',
    });
    expect(r.errors).toEqual([]);
    // wrap 3 (Demurrage) → transfer 3. Should NOT involve unwrap-infl.
    expect(r.steps).toHaveLength(2);
    const wrap = decodeFunctionData({ abi: hubV2Abi, data: r.steps[0].tx.data });
    expect(wrap.functionName).toBe('wrap');
    expect(wrap.args[2]).toBe(0); // CIRCLES_TYPE_DEMURRAGE
    expect(wrap.args[1]).toBe(3n * ONE_CRC_ATTO);
    expect(decodeFunctionData({ abi: demurrageCirclesAbi, data: r.steps[1].tx.data }).functionName).toBe('transfer');
  });

  it('falls back to unwrap-infl + wrap-dem when only inflationary covers the deficit', () => {
    const r = plan({
      entry: makeEntry({ erc1155: 0n, dem: 1n * ONE_CRC_ATTO, infl: 5n * ONE_CRC_ATTO }),
      amountAtto: 3n * ONE_CRC_ATTO,
      targetForm: 'ERC20_DEM',
    });
    expect(r.errors).toEqual([]);
    // [unwrap-infl 2, wrap-dem 2, transfer 3]
    expect(r.steps).toHaveLength(3);
    expect(decodeFunctionData({ abi: inflationaryCirclesAbi, data: r.steps[0].tx.data }).functionName).toBe('unwrap');
    const wrap = decodeFunctionData({ abi: hubV2Abi, data: r.steps[1].tx.data });
    expect(wrap.functionName).toBe('wrap');
    expect(wrap.args[2]).toBe(0);
  });

  it('refuses when demurraged wrapper is not deployed and we need to wrap into it', () => {
    const r = plan({
      entry: makeEntry({ erc1155: 5n * ONE_CRC_ATTO, dem: 0n, demAddr: ZERO_ADDRESS }),
      amountAtto: 3n * ONE_CRC_ATTO,
      targetForm: 'ERC20_DEM',
    });
    expect(r.errors[0]).toMatch(/Demurraged wrapper not yet deployed/);
  });
});

// ─── computeRoute: ERC20_INFL target ────────────────────────
describe('computeRoute: target=ERC20_INFL', () => {
  it('single-tx wrapper.transfer when inflationary balance is enough; native amount uses the factor', () => {
    const r = plan({
      entry: makeEntry({ infl: 10n * ONE_CRC_ATTO }),
      amountAtto: 3n * ONE_CRC_ATTO,
      targetForm: 'ERC20_INFL',
    });
    expect(r.errors).toEqual([]);
    expect(r.steps).toHaveLength(1);
    const decoded = decodeFunctionData({ abi: inflationaryCirclesAbi, data: r.steps[0].tx.data });
    expect(decoded.functionName).toBe('transfer');
    // amount param is native = today * factor / 1e18 = 3 CRC * 1.25 = 3.75 in static atto.
    expect(decoded.args[1]).toBe((3n * ONE_CRC_ATTO * STATIC_FACTOR) / ONE_CRC_ATTO);
  });

  it('prefers wrap from ERC1155 over unwrap-dem + wrap-infl', () => {
    const r = plan({
      entry: makeEntry({ erc1155: 5n * ONE_CRC_ATTO, dem: 5n * ONE_CRC_ATTO, infl: 0n }),
      amountAtto: 2n * ONE_CRC_ATTO,
      targetForm: 'ERC20_INFL',
    });
    expect(r.errors).toEqual([]);
    expect(r.steps).toHaveLength(2);
    const wrap = decodeFunctionData({ abi: hubV2Abi, data: r.steps[0].tx.data });
    expect(wrap.functionName).toBe('wrap');
    expect(wrap.args[2]).toBe(1); // CIRCLES_TYPE_INFLATION
    expect(wrap.args[1]).toBe(2n * ONE_CRC_ATTO);
  });

  it('refuses when inflationary wrapper is not deployed and we need to wrap into it', () => {
    const r = plan({
      entry: makeEntry({ erc1155: 5n * ONE_CRC_ATTO, infl: 0n, inflAddr: ZERO_ADDRESS }),
      amountAtto: 1n * ONE_CRC_ATTO,
      targetForm: 'ERC20_INFL',
    });
    expect(r.errors[0]).toMatch(/Inflationary wrapper not yet deployed/);
  });

  it('refuses to draw from undeployed inflationary wrapper', () => {
    // Pathological state — the indexer would never report an infl balance row
    // without the wrapper deployed, but we still guard against it.
    const r = plan({
      entry: makeEntry({ erc1155: 0n, dem: 0n, infl: 5n * ONE_CRC_ATTO, inflAddr: ZERO_ADDRESS }),
      amountAtto: 1n * ONE_CRC_ATTO,
      targetForm: 'ERC1155',
    });
    expect(r.errors[0]).toMatch(/Inflationary wrapper not deployed/);
  });

  it('refuses when the inflationary conversion ratio is unknown', () => {
    const r = plan({
      entry: makeEntry({ infl: 5n * ONE_CRC_ATTO, staticFactor: 0n }),
      amountAtto: 1n * ONE_CRC_ATTO,
      targetForm: 'ERC20_INFL',
    });
    expect(r.errors[0]).toMatch(/Loading inflationary conversion ratio/);
  });
});

// ─── computeRoute: pool-draining invariants ─────────────────
describe('computeRoute: pool-draining invariants', () => {
  it('drains only the deficit, not the entire pool', () => {
    // Sending 2.5 CRC of ERC1155 from {1155=2, dem=10, infl=0}: should unwrap
    // 0.5 CRC of dem, NOT all 10.
    const r = plan({
      entry: makeEntry({ erc1155: 2n * ONE_CRC_ATTO, dem: 10n * ONE_CRC_ATTO }),
      amountAtto: 2n * ONE_CRC_ATTO + ONE_CRC_ATTO / 2n,
      targetForm: 'ERC1155',
    });
    expect(r.errors).toEqual([]);
    expect(r.steps).toHaveLength(2);
    const unwrap = decodeFunctionData({ abi: demurrageCirclesAbi, data: r.steps[0].tx.data });
    expect(unwrap.args[0]).toBe(ONE_CRC_ATTO / 2n);
  });

  it('tolerates dust (≤ 1000 wei) when comparing entered amount vs balance', () => {
    const entry = makeEntry({ erc1155: 5n * ONE_CRC_ATTO });
    const just = plan({
      entry,
      amountAtto: 5n * ONE_CRC_ATTO + 500n,
      targetForm: 'ERC1155',
    });
    expect(just.errors).toEqual([]);
    expect(just.steps).toHaveLength(1);

    const tooMuch = plan({
      entry,
      amountAtto: 5n * ONE_CRC_ATTO + 2000n,
      targetForm: 'ERC1155',
    });
    expect(tooMuch.errors[0]).toMatch(/Not enough Circles/);
  });
});
