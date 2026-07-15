// Shared configuration constants used across the consolidated miniapps.
// Values are taken verbatim from the three source apps. Where an app used a
// different value, it is noted and the app keeps its own override locally.

import type { Address } from 'viem';

// ── RPC ─────────────────────────────────────────────────────────────────────
export const RPC_URL = 'https://rpc.aboutcircles.com/';
export const RPC_FALLBACK_URLS = [RPC_URL, 'https://rpc.gnosischain.com'];

// Public Gnosis RPC used by the invitations app's viem publicClient.
export const GNOSIS_PUBLIC_RPC = 'https://rpc.gnosischain.com';

// ── Safe ────────────────────────────────────────────────────────────────────
export const SAFE_VERSION = '1.4.1';
export const SAFE_SENTINEL_OWNERS = '0x0000000000000000000000000000000000000001';

// Safe transaction service base URLs.
// group + invitations use the api.safe.global gateway; org historically used the
// legacy host. Both are exported so each app keeps its original endpoint.
export const SAFE_TX_SERVICE_URL = 'https://api.safe.global/tx-service/gno';
export const SAFE_TX_SERVICE_URL_LEGACY = 'https://safe-transaction-gnosis-chain.safe.global';

// ── ERC-4337 ────────────────────────────────────────────────────────────────
export const ENTRYPOINT_V07_ADDRESS = '0x0000000071727de22e5e9d8baf0edac6f37da032' as Address;

// ── Circles core contracts (Gnosis Chain) ──────────────────────────────────
export const HUB_V2_ADDRESS = '0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8' as Address;
export const HUB_V1_ADDRESS = '0x29b9a7fBb8995b2423a71cC17cf9810798F6C543' as Address;
export const NAME_REGISTRY_ADDRESS = '0xA27566fD89162cC3D40Cb59c87AAaA49B85F3474' as Address;
export const ERC20_LIFT_ADDRESS = '0x5F99a795dD2743C36D63511f0D4bc667e6d3cDB5' as Address;
export const BASE_GROUP_FACTORY_ADDRESS = '0xD0B5Bd9962197BEaC4cbA24244ec3587f19Bd06d' as Address;
export const BASE_GROUP_MINT_POLICY = '0x79Cbc9C7077dF161b92a745345A6Ade3fC626A60' as Address;
export const STANDARD_TREASURY = '0x08F90aB73A515308f03A718257ff9887ED330C6e' as Address;

// ── Invitation infrastructure (invitations app) ────────────────────────────
export const AUTH_BASE = 'https://auth.aboutcircles.com';
export const REFERRALS_BASE = 'https://referrals.aboutcircles.com';
export const SESSION_BASE = 'https://circles.gnosis.io/invitation';
export const PATHFINDER_URL = 'https://pathfinder.aboutcircles.com';
export const PROFILE_SERVICE_URL = 'https://profile.aboutcircles.com';

export const INVITATION_FARM = '0xd28b7C4f148B1F1E190840A1f7A796C5525D8902' as Address;
export const INVITATION_MODULE = '0x00738aca013B7B2e6cfE1690F0021C3182Fa40B5' as Address;
export const REFERRALS_MODULE = '0x12105a9b291af2abb0591001155a75949b062ce5' as Address;

// ── Org gas faucet (org app) ────────────────────────────────────────────────
export const FAUCET_XDAI_ADDRESS = '0xbBD0173aafB8b52d6910DD3836dCFE85fc25CA8a' as Address;
export const FAUCET_GROUP_TOKEN_ADDRESS = '0xc19bc204eb1c1d5b3fe500e5e5dfabab625f286c' as Address;
export const FAUCET_CAP_WEI = 1_000_000_000_000_000_000n;
export const FAUCET_PRICE_WEI = 10_000_000_000_000_000n;

// ── Misc on-chain constants ─────────────────────────────────────────────────
export const MAX_UINT96 = 2n ** 96n - 1n;
export const SAFE_OPERATION_CALL = 0;
export const SAFE_OPERATION_DELEGATE_CALL = 1;
