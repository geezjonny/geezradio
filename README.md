# GeezRadio v2.1 — GitHub MP3 music + soundboard

**v2.1:** Any soundboard file can loop as background ambience with the **⟳** button (up to 6 at once), layered under music and one-shot effects, with its own volume slider. Music, effects and ambience volumes are remembered on each device.

This is a **replacement for v1.1**, not a second extension. Both the Music and Soundboard tabs now use audio files hosted on your own GitHub Pages site. No YouTube player.

## Repository layout

Place all these files in the **root** of your existing public repository `geezjonny/geezradio`:

```text
geezradio/
  index.html
  app.js
  style.css
  manifest.json
  icon.svg
  music/
    tavern.mp3
    battle.mp3
  sounds/
    thunder.mp3
    door-creak.mp3
```

The ZIP has empty `music/` and `sounds/` folders (with `.gitkeep` files so GitHub retains the directories). Add your own audio files there. **Don't delete your existing audio files while updating the extension.**

1. Unzip and upload the extension files to the root of `geezradio` (overwrite corresponding files).
2. Upload MP3, OGG, WAV, or M4A files to `music/` for songs and `sounds/` for effects.
3. Enable GitHub Pages from `main` / root if it is not already enabled. Wait for deployment.
4. Reload Owlbear. Reinstall only if the extension is still pointing at an old manifest URL:
   `https://geezjonny.github.io/geezradio/manifest.json`
5. Each person opens GeezRadio, clicks **Enable audio**, and leaves the panel open.
6. As GM, use **Refresh** to list music, add tracks to the queue, then Play. The soundboard reads `sounds/` automatically; press Refresh after uploads.

### What is shared

The **room queue, playback state, loop choice, sound effect triggers, and active ambience loops** are shared using Owlbear room metadata. The GM controls these, and players listen. Music, effects and ambience have separate volume settings for each listener, saved in that browser. Song audio plays through HTML Audio; sound effects use a second player and don't interrupt music. Each ambience loop has its own player, so effects play over it and players who join late still hear it.

**Saved playlists are local to the browser**, with import and export options. Files are public on GitHub Pages and anyone with the links can play/download them. Upload audio you have permission to share.

### Important limitations

- GitHub Pages doesn't provide a browsable directory listing. GeezRadio uses the public GitHub repository API to discover filenames. The GitHub API has anonymous rate limits. If listing fails, the Music tab still supports a manual path, e.g. `music/tavern.mp3`. The soundboard needs directory discovery.
- **GitHub Pages delivery may take a short time** after each new file is committed. Click Refresh again after Pages deploys.
- **Close the GeezRadio panel and audio stops.** This is an iframe popover, not a persistent background audio service. Every player must open and enable audio to listen.
- Playback is **approximately synchronized**, not sample-accurate. The GM needs the panel open for automatic skip at the end of a track.
- Tracks and effects must be hosted beneath `https://geezjonny.github.io/geezradio/music/` and `/sounds/`; arbitrary streaming URLs are not supported.
- The old v1.1 YouTube queue is not compatible with MP3 paths. V2 uses a new local playlist storage key to avoid corrupting older saved playlists.
- Room metadata is small (16 KB total, shared among extensions); queue is limited to 40 items.
- Commands from one panel run in order. If multiple GMs control playback at the same time, room updates can overwrite each other; use one GM panel for playback controls.

## Quick verification

Once you've uploaded `music/tavern.mp3`, check that this opens in your browser:

`https://geezjonny.github.io/geezradio/music/tavern.mp3`

When that works, press Refresh in GeezRadio. If it doesn't show, check the filename capitalization and whether the file is on the `main` branch.

## Development checks

Run `node --test tests/app.test.cjs` and `node --check app.js` with Node.js installed.
The tests use simulated room metadata and audio; browser autoplay and cross-device playback still need an Owlbear session.

Before calling a release done:

- Add at least one music file and verify its GitHub Pages URL.
- Open the extension as a GM and a player on separate devices and enable audio on both.
- Verify play/pause, late joining, queue edits, skipping, repeat-one, and repeat-all (including a one-track queue).
- Trigger and stop effects while music plays; check each listener's independent volume controls, and that they are restored after reopening the panel.
- Loop two ambience sounds, fire a one-shot effect over them, join late as a player, then use Stop ambience.
- Save a playlist, reopen the panel, load it as GM, and verify export/import.
- Verify the deployed manifest and extension load successfully in Owlbear.
