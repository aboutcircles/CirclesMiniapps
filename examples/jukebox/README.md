# Circles Jukebox (miniapp)

A Circles MiniApp that lets people pick a song from a curated SoundCloud catalog and pay **10 CRC** to add it to the global jukebox queue. The audio doesn't play in the miniapp — it plays through the room's speakers via the companion **`jukebox-display`** app, which lives in its own separate repo (it's a standalone webpage, not a miniapp). Both read the same on-chain queue, so keep `JUKEBOX_ADDRESS`, `BASE_AMOUNT_WEI`, `SONG_ID_MOD`, and `START_BLOCK` in sync between them.

## How a payment becomes a queue entry

There is no backend. The miniapp pays with a native Circles ERC-1155 transfer on Hub V2 — `safeTransferFrom(payer, JUKEBOX_ADDRESS, groupTokenId, amount, "")`. Payment is **restricted to group CRC ("gCRC") from two approved groups**: the only accepted `groupTokenId`s are the two in `ACCEPTED_TOKEN_IDS` (for native v2 CRC a token id is just `uint256(uint160(groupAvatar))`). Personal CRC and any other group's CRC are rejected, both when picking what to spend and when reading the queue. It encodes the chosen songId in the low bits of the amount:

```
amount_wei = 10 * 10^18 + songId
```

The recipient receives essentially 10 CRC (the extra is < 1e-13 CRC of dust). The Hub emits `TransferSingle` with exactly this value — demurrage only discounts the sender's stored balance — so any client can recover the songId by reading the event and computing `value % SONG_ID_MOD`. The two approved gCRC wrappers are demurraged 1:1, so 10e18 wei == 10 CRC at par. The display app uses the same trick (and should apply the same token-id allowlist) to play songs in chronological order.

## Tabs

- **Songs** — scrollable catalog from `songs.json`. Tap → confirmation modal → 10 CRC payment → queued.
- **Recent requests** — last 50 paid requests sorted chronologically, with profile name + avatar for each requester. The miniapp does **not** show "now playing"; the source of truth for playback is the display device.

## Configuration

Edit `constants.js`:

| Constant | Meaning |
|---|---|
| `JUKEBOX_ADDRESS` | Treasury that collects payments. The display reads incoming Transfer events to this address. |
| `ACCEPTED_GROUP_ADDRESSES` / `ACCEPTED_TOKEN_IDS` | The two approved groups whose gCRC is accepted as payment. Token ids are derived from the group avatar addresses. Keep in sync with the display. |
| `BASE_AMOUNT_WEI` | `10 * 10^18`. Price per play. |
| `SONG_ID_MOD` | Encoding modulus. Keep songIds in `0 .. SONG_ID_MOD - 1`. |
| `START_BLOCK` | Earliest block scanned by `getLogs`. Set to the jukebox launch block. |

Edit `songs.json` to curate the catalog. Each entry needs:

```json
{
  "id": 1,
  "title": "Song",
  "artist": "Artist",
  "soundcloudUrl": "https://soundcloud.com/...",
  "durationSec": 213,
  "artworkUrl": "https://..."
}
```

The included catalog is illustrative — replace the SoundCloud URLs with tracks you've verified are publicly streamable on SoundCloud's Widget API.

## Local dev

```
npm install
npm run dev
```

The app degrades gracefully outside the wallet iframe: the catalog and the queue still render, but payments are gated on the host bridge.

## Deploy notes

This is a Vite + vanilla JS Vercel deploy. **Vercel Deployment Protection must be disabled** or the app will silently 401 inside the wallet iframe.
