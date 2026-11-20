# Lyssna Lyrics

Lyssna’s lyrics view for Spotify Desktop. The Vite build shares the desktop app’s lyric animation, word rendering, and styles. `src/lyssna/UPSTREAM` records the source commit.

Community lyrics provided by [Lyssna](https://lyssna.org). Imported TTML takes priority, followed by approved Lyssna lyrics and your enabled fallback sources.

## Build

With Node.js LTS installed, run `npm ci` and `npm run build`. `dist/` contains the versioned payload, the v1.0 entrypoint, and the host loaders. `npm run build -- --test` also deploys the payload to `Y:/website/lyssna-plugin/builds/` and points Canary at it. Stable and Beta get their own version fields in `rewrite/v1.0/channels.json`.

Run `npm run build -- --hidden` to publish a standalone build under `builds/hidden/<key>/` and print its access key. Share the key with testers. Anyone with the key can load the build. Keep directory listings disabled for `builds/hidden/`. To retire a key, remove its `release.json` and bundle from the host.

## Install the loader

- **Spicetify** accepts `loader/lyssna-lyrics.mjs` in its Extensions folder. Enable `lyssna-lyrics.mjs` and apply the configuration.
- **SpotiKit** accepts the `dist/spotikit` folder in its Extensions folder.

Open Lyssna from the microphone button in Spotify’s playbar. Older SpotiKit versions use the top bar. Use the playbar’s fullscreen button to open lyrics across the display. In the lyrics view, the fullscreen button and F11 do the same. Hold Shift for cinema mode inside the Spotify window. On clients that expose Document Picture-in-Picture, the pop-out button opens a floating lyrics window with playback controls. The gear opens Lyssna settings.

**Advanced → Build Channel** manages Stable, Beta, Canary and hidden build keys. Stable takes precedence on first launch, followed by Beta and Canary. Paste a hidden build key and choose **Apply and reload** to use that build on this Spotify client. **Remove key** reloads the public channel. The loader falls back to the public channel when the hidden build is unavailable.

Public builds check their selected channel for updates. Add release notes to `PATCH_NOTES.md` under a heading like `## v0.1.0` using bullets. The update dialog shows notes between the previous and current versions.

Preview the notices from Spotify’s DevTools console after Lyssna loads. These previews leave version history unchanged.

```js
LyssnaLyricsRewrite.showStartup()
LyssnaLyricsRewrite.showFirstLoad()
LyssnaLyricsRewrite.showUpdateAvailable()
LyssnaLyricsRewrite.showUpdatedDialog()
```

**Cinema Lyrics Window** opens the full lyrics view in a separate, resizable window and follows Spotify playback. Run `spicetify enable-devtools` with Spicetify, then turn on **Enable Cinema Lyrics Window** in Lyssna’s **Layout** settings. Click **Cinema Lyrics Window** in the playbar to open it. The separate window requires Spotify DevTools to be enabled.

Artist Header uses the lead artist’s Spotify banner and falls back to the album cover. Canvas uses Spotify’s video. Turn on **Animated covers** under **Appearance** to play Apple Music motion covers in the lyrics artwork slot when Canvas is absent. The lookup sends the album barcode to Lyssna. The visualiser uses Spotify’s track analysis.

Effects changes the lyric renderer. Enhancements changes Spotify’s menus, playbar, and playlist picker. The controllers were ported from iPixelGalaxy’s legacy revision `c3e02aa`. When Legacy owns the controllers, changes made in the rewrite apply on the next Spotify restart.

Lyssna reads track-keyed lyrics from the Spicy Lyrics plugin’s cache. When Spicy Lyrics is installed separately, Lyssna reads from its cache and lets that installation run normally. Otherwise Lyssna starts the official plugin in a hidden frame. Use Sources to choose between imported TTML, Spicy Lyrics, and optional online sources. The Library tab manages saved TTML. Clearing Lyssna’s cache keeps imported files and the Spicy Lyrics cache.

## Sync the desktop renderer

Run `npm run sync:app` to import from the sibling `lyssna-app` checkout’s `HEAD`. To select another commit, run `npm run sync:app -- ../lyssna-app <commit>`. Review the snapshot and build again.

The analytic spring in `src/lyssna/lyric-motion.ts` is based on [Fraktality/spr](https://github.com/Fraktality/spr), licensed under MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
