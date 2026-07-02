/**
 * Shared test fixtures mirroring the verified live staging payloads
 * (avatar "gerva7", group score_group). Not a *.test.ts file so vitest's
 * include glob ignores it; imported by the suites.
 */

import type { AvatarScore, Components, HistoryItem, RepConfig } from './types';

export function makeConfig(overrides?: {
  weights?: { R: number; Q: number; I: number };
  gamma?: number;
  aggregation?: string;
  perBilateral?: number;
  legacyEnabled?: boolean;
  gatePenalty?: number;
}): RepConfig {
  return {
    enabled: true,
    refresh_interval_seconds: 120,
    defaults: {
      behaviour: { weights: overrides?.weights ?? { R: 0.5, Q: 0.25, I: 0.25 } },
      propagation: { aggregation: overrides?.aggregation ?? 'off' },
      boost: {
        static: {
          sources: [
            { name: 'backer', group_address: '0x1aca', boost: 100 },
            { name: 'pay_kyc', group_address: '0xb629', boost: 75 },
            { name: 'dappcon26', group_address: '0x4ef6', boost: 50 }
          ]
        },
        network: { per_bilateral: overrides?.perBilateral ?? 0 },
        delta: { gamma: overrides?.gamma ?? 100 },
        legacy: { enabled: overrides?.legacyEnabled ?? true, tau_L_days: 180 }
      },
      composition: { mode: 'centred' },
      gate: { penalty: overrides?.gatePenalty ?? 0 }
    },
    groups: []
  };
}

// gerva7 component tree, verified values.
export function gervaComponents(): Components {
  return {
    behaviour: {
      R_bar: 1.0,
      Q_bar: 0.0,
      I_bar: 0.39646601447526764,
      s_b: 0.5991165036188169,
      ema_primitives: {
        r_bar: 1.0,
        qual_out_bar: 0.0,
        tot_out_bar: 35.55538827079289,
        qual_in_bar: 58.51340264260121,
        tot_in_bar: 147.58643626498505,
        mint_bar: 14.913075309223947
      }
    },
    propagation: {
      s_eff: 0.5991165036188169,
      alpha_used: 0.9933333333333333,
      age_days: 26.0,
      iters: 0,
      converged: true,
      anchor_only: false,
      endorsers: []
    },
    boost: {
      B_static: 75.0,
      B_static_live: 75.0,
      b_static_sources: { pay_kyc: 75.0 },
      b_static_sources_live: { pay_kyc: 75.0 },
      B_network: 0.0,
      B_delta: 0.14423119791356281,
      B_legacy: 52.38024123120556,
      B_legacy_active: false,
      B_total: 89.42311979135629,
      delta_state: { b_mem: 0.14423119791356281, daily_change: -0.00017139074754085883 }
    },
    gate: {
      snapshot: {},
      live: {
        balance: 945.2271237340838,
        outstanding: 339.9986981274619,
        non_qualified_outflow_window: 1355.0846149414356,
        qualified_inflow_window: 493.9293720312962,
        gate_debt: 1327.750696383333,
        gate_triggered: false,
        liveness_factor: 1.0,
        s_user_raw: 109.24642051511965,
        s_user_gated: 109.24642051511965,
        s_user: 100.0,
        score_uint: 109
      }
    },
    composition: {
      s_eff_used: 0.5991165036188169,
      base: 19.82330072376337,
      s_user_raw: 109.24642051511965
    }
  };
}

export function gervaAvatar(): AvatarScore {
  return {
    address: '0x0004df58332be821ebd0a2f498c211873e3b8f2c',
    is_member: true,
    blacklisted: false,
    raw_score: 1.0,
    reputation_score: 109,
    reputation_score_live: 109,
    behaviour_score: 59.91,
    boost_score: 75.0,
    source: 'cached',
    components: gervaComponents()
  };
}

/** A slim non-member payload (no components), as returned for unknown addresses. */
export function nonMemberAvatar(addr = '0x000000000000000000000000000000000000dead'): AvatarScore {
  return {
    address: addr as AvatarScore['address'],
    is_member: false,
    blacklisted: false,
    boost_score: 0,
    reputation_score_live: 0
  };
}

export function makeHistoryItem(
  snapshot_at: string,
  live: number,
  parts?: {
    behaviour?: number;
    bStatic?: number;
    bLegacy?: number;
    bDelta?: number;
    liveness?: number;
    is_member?: boolean;
    rBar?: number;
    qBar?: number;
    iBar?: number;
    staticSources?: Record<string, number>;
  }
): HistoryItem {
  const c = gervaComponents();
  c.boost.B_static = parts?.bStatic ?? c.boost.B_static;
  c.boost.B_legacy = parts?.bLegacy ?? c.boost.B_legacy;
  c.boost.B_delta = parts?.bDelta ?? c.boost.B_delta;
  if (parts?.rBar !== undefined) c.behaviour.R_bar = parts.rBar;
  if (parts?.qBar !== undefined) c.behaviour.Q_bar = parts.qBar;
  if (parts?.iBar !== undefined) c.behaviour.I_bar = parts.iBar;
  if (parts?.staticSources) c.boost.b_static_sources = parts.staticSources;
  return {
    snapshot_at,
    reputation_score: live,
    reputation_score_live: live,
    behaviour_score: parts?.behaviour ?? 59.91,
    boost_score: parts?.bStatic ?? 75,
    liveness_factor: parts?.liveness ?? 1,
    is_member: parts?.is_member ?? true,
    components: c
  };
}
