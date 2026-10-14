# GeezRadio v1.0

A simple YouTube queue for Owlbear Rodeo. Host these files at the root of a GitHub Pages repository.

## Install

1. Create a public GitHub repository named `GeezRadio`.
2. Upload all five files (`manifest.json`, `index.html`, `app.js`, `style.css`, `icon.svg`) into the repository root.
3. Under Settings → Pages, publish from the `main` branch root.
4. In Owlbear Rodeo, install: `https://geezjonny.github.io/GeezRadio/manifest.json`.
5. Every player should open the GeezRadio action and click **Enable audio on this device**. Leave that panel open during playback.
6. The GM adds video links and controls the queue. Loop modes: Off / All / One. Every player controls their own volume.

## Known limitations

- Owlbear action popovers are not guaranteed to persist once closed. Audio **stops when the panel closes**. Future versions can explore a background audio implementation, but browser autoplay restrictions apply.
- YouTube embeds can be blocked by the video owner, the browser, or embedded iframe security policies.
- Every participant must click Enable audio; autoplay may need another click directly inside the embedded YouTube video.
- Sync is best-effort, not sample-accurate: YouTube players buffer independently. GM advances the queue when their video ends; if GM closes the panel, automatic advancement cannot occur. Manual Skip still works.
- This uses Owlbear room metadata (under 16 KB) for a small queue; it is **not** Firebase and does not upload/rehost copyrighted audio.
- YouTube playlist URLs are not imported. Add individual video links.
- Actual playback inside Owlbear has not been verified yet.
