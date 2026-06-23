import { describe, it, expect } from 'vitest';
import { deriveStages, gateActiveForAvatar } from './stages';
import { makeConfig } from './_fixtures';
import type { GateLive } from './types';

describe('deriveStages — current live config', () => {
  const s = deriveStages(makeConfig());

  it('behaviour always active', () => {
    expect(s.behaviour.active).toBe(true);
  });
  it('propagation inactive (aggregation off)', () => {
    expect(s.propagation.active).toBe(false);
  });
  it('network boost inactive (per_bilateral 0)', () => {
    expect(s.network.active).toBe(false);
  });
  it('liveness gate inactive (penalty 0)', () => {
    expect(s.gate.active).toBe(false);
  });
  it('momentum active (gamma 100)', () => {
    expect(s.momentum.active).toBe(true);
  });
  it('legacy active (enabled)', () => {
    expect(s.legacy.active).toBe(true);
  });
});

describe('deriveStages — flips with config', () => {
  it('propagation activates when aggregation != off', () => {
    expect(deriveStages(makeConfig({ aggregation: 'mean' })).propagation.active).toBe(true);
  });
  it('network activates with per_bilateral > 0', () => {
    expect(deriveStages(makeConfig({ perBilateral: 2 })).network.active).toBe(true);
  });
  it('gate activates with penalty != 0', () => {
    expect(deriveStages(makeConfig({ gatePenalty: 0.5 })).gate.active).toBe(true);
  });
  it('momentum deactivates with gamma 0', () => {
    expect(deriveStages(makeConfig({ gamma: 0 })).momentum.active).toBe(false);
  });
  it('legacy deactivates when disabled', () => {
    expect(deriveStages(makeConfig({ legacyEnabled: false })).legacy.active).toBe(false);
  });
});

describe('gateActiveForAvatar — per-avatar override', () => {
  const stages = deriveStages(makeConfig()); // gate globally off
  const base: GateLive = {
    balance: 0,
    outstanding: 0,
    non_qualified_outflow_window: 0,
    qualified_inflow_window: 0,
    gate_debt: 0,
    gate_triggered: false,
    liveness_factor: 1,
    s_user_raw: 0,
    s_user_gated: 0,
    s_user: 0,
    score_uint: 0
  };

  it('off when global off and avatar unaffected', () => {
    expect(gateActiveForAvatar(stages.gate, base)).toBe(false);
  });
  it('on when avatar gate_triggered', () => {
    expect(gateActiveForAvatar(stages.gate, { ...base, gate_triggered: true })).toBe(true);
  });
  it('on when avatar liveness_factor != 1', () => {
    expect(gateActiveForAvatar(stages.gate, { ...base, liveness_factor: 0.4 })).toBe(true);
  });
  it('on when global gate active regardless of avatar', () => {
    const onStages = deriveStages(makeConfig({ gatePenalty: 1 }));
    expect(gateActiveForAvatar(onStages.gate, base)).toBe(true);
  });
});
