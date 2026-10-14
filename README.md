# GeezRadio v1.1

Owlbear Rodeo extension with named YouTube tracks, a shared music queue, saved playlists, and a YouTube soundboard.

## Install

Upload `index.html`, `app.js`, `style.css`, `manifest.json`, and `icon.svg` into the ROOT of your GitHub repository named **geezradio** (lowercase). Enable GitHub Pages from `main` / root.

Install in Owlbear using:

https://geezjonny.github.io/geezradio/manifest.json

Update an existing installation by replacing all five files, then hard refresh the Owlbear room. If Owlbear caches an older extension manifest, remove and re-add it.

## How to use

- **Music:** GM pastes a YouTube URL, supplies an optional name, and queues it. Rename a queued track using ✎. All players see the same queue.
- **Playlists:** Save the current queue in **this browser's localStorage**, load it later as GM, or Export/Import JSON to move playlists to another browser. These saved playlists are *not* room-synced; loading one replaces the shared queue.
- **Soundboard:** GM registers short YouTube clips and triggers them on a separate YouTube player, while background music keeps running. Sound buttons are shared via Owlbear room metadata.
- **Audio:** Every participant must open the extension and activate audio on their device. Keep the extension open to listen. Browser autoplay limitations and videos that forbid embedding still apply.

## Notes

- Names of already-queued tracks from v1 are displayed as `YouTube <video ID>`; use ✎ to rename them.
- The soundboard isn't instantaneous: YouTube loads videos remotely and may show ads or deny embeds.
- YouTube is not a substitute for short, locally hosted audio samples if low latency is essential.
- GM controls shared room state; queue and soundboard entries survive popup closure subject to Owlbear room metadata lifetime.
- No API keys or Firebase changes required.
