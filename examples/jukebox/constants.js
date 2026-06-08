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
// This is an org avatar that trusts the Gnosis group, so any Gnosis
// group member can transfer wrapped group CRC to it.
export const JUKEBOX_ADDRESS = '0xbe6e5a0bdface700cbe8f0d1c28fcb8404a1622b';

// Only this exact wrapped ERC-20 token is accepted as payment: the
// DEMURRAGED Gnosis group CRC wrapper. Demurraged means 1e18 raw == 1 CRC
// today (1:1), which is exactly what the songId-in-low-bits encoding needs
// (amount = 10e18 + songId == 10 CRC + songId). The inflationary wrapper
// (0xeeF7B1f06B092625228C835Dd5D5B14641D1e54A) was wrong here: 10e18 of it
// is only ~6.67 CRC, so payments underpaid by ~33%.
export const ACCEPTED_TOKEN_ADDRESS = '0x548c20e6c24E4876E20daDbEAb75362e2F5A4bC1';

// The Gnosis group avatar. Used as the avatar arg for groupMint + wrap in the
// auto-mint flow (user has personal CRC but no wrapped group CRC yet).
export const GNOSIS_GROUP_ADDRESS = '0xc19bc204eb1c1d5b3fe500e5e5dfabab625f286c';

// Circles Hub V2 (ERC-1155). groupMint + wrap are called here.
export const HUB_V2_ADDRESS = '0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8';

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

// Earliest block to scan. Bump this when deploying a fresh playlist to
// ignore payments from previous events. Set to current block at deploy
// time so the queue starts empty.
export const START_BLOCK = 46_625_000n;
