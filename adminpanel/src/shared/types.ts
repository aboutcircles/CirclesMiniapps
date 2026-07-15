// Shared domain types across the consolidated miniapps.
// App-specific types that don't overlap stay local to each app.

import type { Address } from 'viem';

// ── Invitations domain ──────────────────────────────────────────────────────

export interface Session {
  id: string;
  slug: string;
  label?: string;
  paused: boolean;
  expiresAt?: string;
  queuedCount?: number;
  dispatchedCount?: number;
  claimedCount?: number;
}

export interface SessionStats {
  queued?: number;
  dispatched?: number;
  dispatchedInFlight?: number;
  dispatchedExpired?: number;
  claimed?: number;
  label?: string;
  paused?: boolean;
  expiresAt?: string;
  [key: string]: unknown;
}

export interface KeyEntry {
  id: string;
  privateKey?: string;
  keyPreview?: string;
  accountAddress?: string;
  status: 'queued' | 'dispatched' | 'claimed';
}

export interface Referral {
  id: string;
  privateKey?: string;
  accountAddress?: string;
  status: string;
  sessions: string[];
}

export interface Challenge {
  challengeId: string;
  message: string;
}

// ── Group domain ────────────────────────────────────────────────────────────

export interface GroupEntry {
  group: Address | string;
  name?: string;
  symbol?: string;
  owner?: Address | string;
  treasury?: Address | string;
  mintHandler?: Address | string;
  service?: Address | string;
  feeCollection?: Address | string;
  memberCount?: number;
  _role?: 'owner' | 'service';
  /** Set when acting on behalf of this group via a Safe multisig (inherited ownership). */
  _ownerSafe?: string;
  [key: string]: unknown;
}

export interface SessionGroupRecord {
  group: string;
  name: string;
  role: string;
  ownerSafe?: string;
}

// ── Shared UI result type ───────────────────────────────────────────────────

export type ResultType = 'success' | 'error' | 'pending';
