// Shared constants for the Affiliate Link miniapp.
// All addresses are Gnosis Chain (chain id 100). Stored lowercased and passed
// through viem's getAddress() at use, so a transcription slip can never produce
// a bad checksum.

export const RPC_URL = 'https://rpc.aboutcircles.com/';

// Fallback RPCs used for the (best-effort) reads and receipt polling.
export const RPC_FALLBACKS = [
  RPC_URL,
  'https://rpc.gnosischain.com',
  'https://1rpc.io/gnosis',
];

// AffiliateGroupRegistry — stores each human's affiliate group on Gnosis Chain.
//   setAffiliateGroup(address newGroup)  → sets the caller's affiliate group
//   affiliateGroup(address human) → address  → reads a human's current affiliate
//   event AffiliateGroupChanged(human, oldGroup, newGroup)
// Verified: https://gnosis.blockscout.com/address/0xca8222e780d046707083f51377B5Fd85E2866014
export const AFFILIATE_GROUP_REGISTRY = '0xca8222e780d046707083f51377b5fd85e2866014';

// Circles Hub V2 — used only to (best-effort) check `isGroup(address)` so the
// admin gets a warning before sharing a link that points at a non-group.
export const HUB_V2_ADDRESS = '0xc12c1e50abb450d6205ea2c3fa861b3b834d13e8';

// The share link wraps the app in a Circles host's Playground so it works
// WITHOUT a marketplace catalog entry:
//   `${SHARE_BASE_URL}/playground?url=<urlencoded(`${APP_BASE_URL}?data=<base64>`)>`
// The Playground loads APP_BASE_URL directly in an iframe and does NOT forward
// app_data, so the payload rides in the app's own `?data=` query (the
// URL-fallback path in parseGroupPayload).
export const SHARE_BASE_URL = 'https://circles.gnosis.io';

// The app's own canonical deployment — the iframe target embedded in the host.
export const APP_BASE_URL = 'https://affiliate-link-one.vercel.app/';

// Reserved for a future marketplace listing: once an entry with this slug lives
// in static/miniapps.json and the host redeploys, a cleaner
// `${SHARE_BASE_URL}/miniapps/${SHARE_SLUG}?data=…` link becomes possible.
export const SHARE_SLUG = 'affiliate-link';

// The affiliate group receives 1/12 of the CRC a member mints. A human mints
// 24 CRC/day, so that is ~2 CRC/day per affiliated member. Used in UI copy only.
export const AFFILIATE_SHARE_FRACTION = '1/12';
export const AFFILIATE_SHARE_PER_DAY = '~2 CRC/day';
