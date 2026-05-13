# Circles Jukebox (miniapp)

A Circles MiniApp that lets people pick a song from a curated SoundCloud catalog and pay **10 CRC** to add it to the global jukebox queue. The audio doesn't play in the miniapp — it plays through the room's speakers via the companion `jukebox-display` page.

## How a payment becomes a queue entry

There is no backend. The miniapp pays with a standard wrapped CRC ERC-20 `transfer` to a fixed `JUKEBOX_ADDRESS`, but it encodes the chosen songId in the low bits of the amount:

```
amount_wei = 10 * 10^18 + songId
```

The recipient receives essentially 10 CRC (the extra is < 1e-13 CRC of dust). Any client can recover the songId by reading the transfer log and computing `value % SONG_ID_MOD`. The display app uses the same trick to play songs in chronological order.

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
