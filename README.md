# Lyssna Lyrics

Lyssna’s lyrics view for Spotify Desktop. The Vite build shares the desktop app’s lyric animation, word rendering, and styles. `src/lyssna/UPSTREAM` records the source commit.

## Build

With Node.js LTS installed, run `npm ci` and `npm run build`. `dist/` contains the versioned payload, the v1.0 entrypoint, and the host loaders. `npm run build -- --test` also deploys the payload to `Y:/website/lyssna-plugin/builds/` and points Canary at it. Stable and Beta get their own version fields in `rewrite/v1.0/channels.json`.

## Install the loader

- **Spicetify** accepts `loader/lyssna-lyrics.mjs` in its Extensions folder. Enable `lyssna-lyrics.mjs` and apply the configuration.
- **SpotiKit** accepts the `dist/spotikit` folder in its Extensions folder.

Open Lyssna from the microphone button in Spotify’s playbar. Older SpotiKit versions use the top bar. Use the full screen button or F11 to expand the main view. On clients that expose Document Picture-in-Picture, the pop-out button opens a floating lyrics window with playback controls. The gear opens Lyssna settings, where changes apply immediately and persist across Spotify restarts. The Build channel selector is under Advanced. Stable takes precedence on first launch, followed by Beta and Canary.

Artist Header uses the lead artist’s Spotify banner and falls back to the album cover. The Canvas setting uses the video Spotify exposes in Now playing. The visualiser uses Spotify’s track analysis. The host supplies these features when it has data for the current track.

Lyssna reads track-keyed lyrics from the Spicy Lyrics plugin’s cache. When Spicy Lyrics is installed separately, Lyssna reads from its cache and lets that installation run normally. Otherwise Lyssna starts the official plugin in a hidden frame. Lyrics that bypass the provider’s cache are outside this draft’s integration.

## Sync the desktop renderer

Run `npm run sync:app` to import from the sibling `lyssna-app` checkout’s `HEAD`. To select another commit, run `npm run sync:app -- ../lyssna-app <commit>`. Review the snapshot and build again.

The analytic spring in `src/lyssna/lyric-motion.ts` is based on [Fraktality/spr](https://github.com/Fraktality/spr), licensed under MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
