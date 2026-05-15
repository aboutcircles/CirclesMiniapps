// Mirror of examples/jukebox/constants.js — keep both in sync.

export const RPC_URL = 'https://rpc.aboutcircles.com/';

export const RPC_FALLBACKS = [
  RPC_URL,
  'https://rpc.gnosischain.com',
  'https://1rpc.io/gnosis',
];

export const JUKEBOX_ADDRESS = '0xbe6e5a0bdface700cbe8f0d1c28fcb8404a1622b';

// Wrapped Gnosis group CRC. Only Transfer events of this exact token to
// JUKEBOX_ADDRESS count as a paid song request.
export const ACCEPTED_TOKEN_ADDRESS = '0xeeF7B1f06B092625228C835Dd5D5B14641D1e54A';

export const BASE_AMOUNT_WEI = 10n * 10n ** 18n;
export const SONG_ID_MOD = 10000n;

export const TRANSFER_EVENT_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export const START_BLOCK = 41_500_000n;

// How often to refresh the queue from chain (milliseconds).
export const POLL_INTERVAL_MS = 10_000;

// localStorage key for the playhead.
export const PLAYHEAD_KEY = 'jukebox.playhead.v1';
