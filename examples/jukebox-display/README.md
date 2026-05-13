# Circles Jukebox · Display

A standalone webpage you open on a laptop wired to the venue's TV and speakers. **This is not a miniapp** — it's never loaded inside the Circles wallet iframe. It's the audio engine and the on-screen "now playing" board for the jukebox.

## What it does

1. Polls Gnosis Chain every 10s for incoming ERC-20 `Transfer` events to `JUKEBOX_ADDRESS`.
2. Decodes each transfer amount: `songId = value % SONG_ID_MOD`. Discards any transfer whose base amount isn't exactly 10 CRC.
3. Sorts requests chronologically (by `(blockNumber, logIndex)`).
4. Plays them in order via SoundCloud's Widget API (the hidden `<iframe>` in `index.html`).
5. When a song finishes (or errors), saves the `txHash` to `localStorage` and advances. Reloads resume from the same spot.
6. Resolves each requester's wallet to a Circles profile so the big screen shows the actual name + avatar of who queued the song.

## Layout

- **Now playing** — large artwork, song title, artist, "queued by @name" pill.
- **Up next** — next 8 requests with attribution.

## Setup

```
npm install
npm run dev
```

Open in fullscreen on the display device. Make sure system audio is routed to the venue's speakers and SoundCloud autoplay is allowed (click once on the page to satisfy browser autoplay policies if needed).

## Configuration

Keep `constants.js` and `songs.json` in sync with `examples/jukebox/`. The `JUKEBOX_ADDRESS`, `BASE_AMOUNT_WEI`, `SONG_ID_MOD`, and `START_BLOCK` must match exactly on both sides or the display won't see the same queue.

## Resetting the playhead

If you want to replay history from the start (e.g. between events), clear localStorage on the display device:

```js
localStorage.removeItem('jukebox.playhead.v1');
```
