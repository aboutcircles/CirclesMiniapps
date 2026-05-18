// Mirror of examples/jukebox/constants.js — keep both in sync.

export const RPC_URL = 'https://rpc.aboutcircles.com/';

export const RPC_FALLBACKS = [
  RPC_URL,
  'https://rpc.gnosischain.com',
  'https://1rpc.io/gnosis',
];

export const JUKEBOX_ADDRESS = '0xbe6e5a0bdface700cbe8f0d1c28fcb8404a1622b';

// Demurraged Gnosis group CRC wrapper (1e18 raw == 1 CRC today). Only
// Transfer events of this exact token to JUKEBOX_ADDRESS count as a paid
// song request. Must stay in sync with examples/jukebox/constants.js.
export const ACCEPTED_TOKEN_ADDRESS = '0x548c20e6c24E4876E20daDbEAb75362e2F5A4bC1';

export const BASE_AMOUNT_WEI = 10n * 10n ** 18n;
export const SONG_ID_MOD = 10000n;

export const TRANSFER_EVENT_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export const START_BLOCK = 41_500_000n;

// How often to refresh the queue from chain (milliseconds).
export const POLL_INTERVAL_MS = 10_000;

// localStorage key for the playhead.
export const PLAYHEAD_KEY = 'jukebox.playhead.v1';
