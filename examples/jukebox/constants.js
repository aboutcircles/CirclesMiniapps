// Shared constants for the Jukebox miniapp and display.
// Both apps read the same on-chain truth — keep these values in sync.

export const RPC_URL = 'https://rpc.aboutcircles.com/';

// Fallback RPCs used for receipt polling and getLogs.
export const RPC_FALLBACKS = [
  RPC_URL,
  'https://rpc.gnosischain.com',
  'https://1rpc.io/gnosis',
];

// The jukebox treasury address. Every 10 CRC payment is sent here.
// All clients (miniapp + display) read incoming ERC-20 Transfer events
// to this address to assemble the global queue.
//
// REPLACE before going live with the host's real treasury address.
export const JUKEBOX_ADDRESS = '0x000000000000000000000000000000000000dEaD';

// Payment encoding.
// Each play costs exactly 10 CRC. The chosen songId (0..SONG_ID_MOD-1) is
// encoded in the low bits of the transfer amount: the recipient receives
// 10e18 wei + songId wei, where songId wei is < 1e-13 CRC of dust.
//
// Decoder: songId = Number(amount % SONG_ID_MOD)
export const BASE_AMOUNT_WEI = 10n * 10n ** 18n;
export const SONG_ID_MOD = 10000n;

// ERC-20 Transfer event signature: Transfer(address,address,uint256)
// keccak256("Transfer(address,address,uint256)")
export const TRANSFER_EVENT_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Earliest block to scan. Set to the deploy time of the jukebox so the
// display doesn't waste a full chain scan on first load.
export const START_BLOCK = 35_000_000n;
