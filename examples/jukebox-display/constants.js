// Mirror of examples/jukebox/constants.js — keep both in sync.

export const RPC_URL = 'https://rpc.aboutcircles.com/';

export const RPC_FALLBACKS = [
  RPC_URL,
  'https://rpc.gnosischain.com',
  'https://1rpc.io/gnosis',
];

export const JUKEBOX_ADDRESS = '0xbe6e5a0bdface700cbe8f0d1c28fcb8404a1622b';

// Accepted payment tokens: DEMURRAGED group-CRC wrappers from the two
// approved groups. The display watches for incoming ERC-20 Transfer events
// to JUKEBOX_ADDRESS across this whole list (filter happens client-side
// after the indexer query). 1e18 raw == 1 CRC (1:1) — the songId-in-low-bits
// encoding depends on this. Inflationary wrappers (1e18 raw ~= 0.667 CRC)
// are intentionally excluded because they break the songId decode.
export const ACCEPTED_TOKEN_ADDRESSES = [
  // Group 1: 0xc19bc204eb1c1d5b3fe500e5e5dfabab625f286c — original "Gnosis" gCRC
  '0x548c20e6c24E4876E20daDbEAb75362e2F5A4bC1',
  // Group 2: 0x93eD5A96347927ff6fF6b790F8Cf5258240c321f — second "Gnosis" gCRC
  '0x8cbd18accdce45a3e6ac6909ecf42ee13f1f927a',
];
export const ACCEPTED_TOKEN_SET = new Set(ACCEPTED_TOKEN_ADDRESSES.map(a => a.toLowerCase()));

export const BASE_AMOUNT_WEI = 10n * 10n ** 18n;
export const SONG_ID_MOD = 10000n;

export const TRANSFER_EVENT_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Bump when deploying a fresh playlist to ignore old payments.
export const START_BLOCK = 46_625_000n;

// How often to refresh the queue from chain (milliseconds).
export const POLL_INTERVAL_MS = 10_000;

// localStorage key for the playhead.
export const PLAYHEAD_KEY = 'jukebox.playhead.v2';