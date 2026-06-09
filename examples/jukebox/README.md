# Circles Jukebox (miniapp)

A Circles MiniApp that lets people pick a song from a curated SoundCloud catalog and pay **10 CRC** to add it to the global jukebox queue. The audio doesn't play in the miniapp — it plays through the room's speakers via the companion **`jukebox-display`** app, which lives in its own separate repo (it's a standalone webpage, not a miniapp). Both read the same on-chain queue, so keep `JUKEBOX_ADDRESS`, `BASE_AMOUNT_WEI`, `SONG_ID_MOD`, and `START_BLOCK` in sync between them.

## How a payment becomes a queue entry

There is no backend. The miniapp pays with a native Circles ERC-1155 transfer on Hub V2 — `safeTransferFrom(payer, JUKEBOX_ADDRESS, personalCrcId, amount, "")`, where `personalCrcId == uint256(uint160(payer))` is the payer's own personal CRC. It encodes the chosen songId in the low bits of the amount:

```
amount_wei = 10 * 10^18 + songId
```

The recipient receives essentially 10 CRC (the extra is < 1e-13 CRC of dust). The Hub emits `TransferSingle` with exactly this value — demurrage only discounts the sender's stored balance — so any client can recover the songId by reading the event and computing `value % SONG_ID_MOD`. Native CRC is demurraged 1:1 for every avatar, so any avatar's CRC pays at par and there's no token allowlist. The display app uses the same trick to play songs in chronological order.

## Tabs

- **Songs** — scrollable catalog from `songs.json`. Tap → confirmation modal → 10 CRC payment → queued.
- **Recent requests** — last 50 paid requests sorted chronologically, with profile name + avatar for each requester. The miniapp does **not** show "now playing"; the source of truth for playback is the display device.

## Configuration

Edit `constants.js`:

| Constant | Meaning |
|---|---|
| `JUKEBOX_ADDRESS` | Treasury that collects payments. The display reads incoming Transfer events to this address. |
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
