// Shared constants for the Jukebox miniapp and display.
// Both apps read the same on-chain truth — keep these values in sync.

export const RPC_URL = 'https://rpc.aboutcircles.com/';

// Fallback RPCs used for receipt polling and balance reads.
export const RPC_FALLBACKS = [
  RPC_URL,
  'https://rpc.gnosischain.com',
  'https://1rpc.io/gnosis',
];

// The jukebox treasury address. Every 10 CRC payment is sent here.
// All clients (miniapp + display) read incoming Circles ERC-1155
// TransferSingle events to this address to assemble the global queue.
//
// It is a Safe-based org avatar that implements onERC1155Received, so a
// direct Hub V2 safeTransferFrom of any avatar's CRC to it succeeds.
export const JUKEBOX_ADDRESS = '0xbe6e5a0bdface700cbe8f0d1c28fcb8404a1622b';

// Circles Hub V2 (ERC-1155). Payments are native CRC transferred via
// `safeTransferFrom(from, JUKEBOX_ADDRESS, tokenId, amount, "")`, where
// tokenId == uint256(uint160(payer)) is the payer's personal-CRC id.
//
// Native Hub V2 balances are always demurraged (1e18 raw == 1 CRC today),
// for every avatar's token, so any CRC pays at par — there is no need for an
// accepted-token allowlist and no inflationary/demurraged mismatch to guard
// against (that was only a concern for the old wrapped-ERC-20 rail).
export const HUB_V2_ADDRESS = '0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8';

// ─── Accepted payment tokens ────────────────────────────────
// Payment is restricted to native group CRC ("gCRC") from exactly two approved
// Circles groups. Personal CRC and any other group's CRC are rejected — both
// when picking what to spend and when reading the queue.
//
// For native Hub V2 CRC an ERC-1155 token id IS its issuing avatar address as a
// uint256, so the two accepted token ids are just BigInt() of the group avatars
// below. (The on-chain `id` column / balance `tokenId` carry exactly this.)
export const GNOSIS_GROUP_ADDRESS = '0xc19bc204eb1c1d5b3fe500e5e5dfabab625f286c';   // Group 1 — "Gnosis" gCRC
export const GNOSIS_GROUP_2_ADDRESS = '0x93eD5A96347927ff6fF6b790F8Cf5258240c321f'; // Group 2 — second "Gnosis" gCRC

export const ACCEPTED_GROUP_ADDRESSES = [GNOSIS_GROUP_ADDRESS, GNOSIS_GROUP_2_ADDRESS];

// The two accepted ERC-1155 token ids, as BigInts. Compare with
// `BigInt(x) === id` so both the hex form (balance.tokenId) and the decimal
// form (indexer `id` column) match without string-format fragility.
export const ACCEPTED_TOKEN_IDS = ACCEPTED_GROUP_ADDRESSES.map(a => BigInt(a));

// Payment encoding.
// Each play costs exactly 10 CRC. The chosen songId (0..SONG_ID_MOD-1) is
// encoded in the low bits of the transfer amount: the recipient receives
// 10e18 wei + songId wei, where songId wei is < 1e-13 CRC of dust.
//
// The Hub emits TransferSingle with exactly the transferred value (demurrage
// only discounts the sender's stored balance, via a separate burn to the zero
// address), so the songId survives on-chain untouched.
//
// Decoder: songId = Number(amount % SONG_ID_MOD)
export const BASE_AMOUNT_WEI = 10n * 10n ** 18n;
export const SONG_ID_MOD = 10000n;

// Earliest block to scan. Bump this when deploying a fresh playlist to
// ignore payments from previous events. Set to ~current block at deploy
// time so the queue starts empty.
export const START_BLOCK = 46_606_900n;
