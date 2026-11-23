# Lyssna Lyrics patch notes

## v1.1.0

### ✨ Highlights

- **Apple Music lyrics through Lyssna.** Apple Music word sync takes priority. Spicy Lyrics community syncs are used when they have word timing and Apple Music has line timing or less. TTML Creator can start from Lyssna’s Apple Music lyrics, and the lyrics footer credits Apple Music (via Lyssna).
- **Space Gravity reacts to the visualizer.** Bars send individual words flying on contact. A new Word density slider lets you decide how many words float around the current line.
- **Highlighter follows the words.** The ink stays connected as lyrics bounce in the regular view or drift in Space Gravity. The trail can glide toward the next word while a brighter stroke stays in time with the song.
- **Fullscreen and Cinema get the Lyssna desktop controls.** Use the glass seek and volume sliders, save the song from its artwork, and choose whether time or playback controls stay visible. Instrumental tracks show centered album artwork in the regular and fullscreen views.
- **TTML Creator gains song sections and singer labels.** Use labels like `[Chorus]` in the text editor, or fetch matching sections from Genius while keeping your existing words and timing.
- **Review submissions inside Spotify.** Reviewers can open the Priority and Backlog queues from the top bar, then select a submission to compare changes, play the draft, comment, or make a decision in Creator.

### 🎨 Lyrics and appearance

- Added the **Bouncy Lyrics** animator preset. Animator Behavior now opens beside the lyrics so you can see your tuning in action, with sliders that match the rest of Settings.
- Pin the visualizer, animator presets, word filters, or lyrics font to the lyrics toolbar. Pickers expand from their own buttons, and the font picker remembers your custom font when you switch back to Default.
- The toolbar stays on one row and scrolls sideways when space runs out. It follows Liquid Glass, plays its icon animations once per hover or keyboard focus, and holds its position when you swap artwork sides.
- Swapping artwork sides animates the cover and lyrics into place. Pinned Space Gravity credits move with the lyrics, and manual scrolling stops at the songwriter credits when the rest of the footer is pinned.
- The visualizer uses 48 shorter bars. Space Gravity trails follow the ink as words move, retract from the tail, and darken where strokes cross. Standalone backing vocals get a trail for their own phrase.
- Hovering between fullscreen buttons keeps them at full brightness. Tracks without lyrics follow the same fullscreen visibility setting as other tracks.
- Songs without lyrics show shortcuts to TTML Creator, Discord, retry, and lyric file import. Fullscreen and Cinema center the album artwork for those songs.
- Lyrics and app fonts have separate switches. Appearance drops the light, dark, and system theme selector.

### 🛠️ Creator, community, and storage

- Open a Lyssna song page by clicking its contributor credits. Browse profiles and edit history inside Spotify, use Back to return to a previous page, and keep the sheet open when the track changes.
- The first upload from Creator or Load TTML shows the Lyssna terms and explains why published syncs stay available for community edits.
- When a song’s first submission is an edit of word-synced Apple Music lyrics from Creator, Lyssna keeps the original sync alongside the edit. The song page credits Apple Music on the original.
- Reviewers can mark a recording as instrumental from the missing-lyrics screen.
- Press Delete on a selected word or select the line number to delete the full line. Undo restores the edit.
- The Creator transport sits clear of the editor content and spectrogram. The playback speed slider follows the Lyssna desktop styling.
- The recording meter and its actions are available in Creator and the Spotify playbar. Fully recorded songs keep their saved audio and spectrogram when you play them again.
- **Manage Stored Data** shows storage use faster and lets you remove individual recordings, spectrograms, and animated covers. When exports are enabled, you can also save individual audio files, spectrogram PNGs, and cover videos.
- Spicy Lyrics community syncs now come directly from the official API, so Lyssna no longer starts the Spicy Lyrics extension in the background. Apple Music via Spicy Lyrics is reserved for when Lyssna’s Apple Music lookup is unavailable.

### Spotify tweaks and updates

- **Enhance Spotify Performance** is on by default. Volume stays responsive while dragging, and playbar and sidebar updates are grouped to reduce extra redraws.
- **Spotify Tweaks** replaces Enhancements. Hide Home Config works with Spotify’s current profile menu, and the classic device picker shows icons for more device types.
- The Now Playing artist card uses the first photo from the artist’s About gallery when available, with the artist name, listener count, and Follow button over the image.
- F5 reloads Spotify on macOS when Spotify receives the key and you’re outside a text field.
- The Stable launcher loads from GitHub even when the test server is unavailable. Canary update prompts show the notes for the build you installed.
- Build Channels refreshes available builds each time you open Manage.

## v1.0.0

### A fresh start, I wonder what adventures await us?

- **Word-synced lyrics** in Spotify’s main view, Now Playing sidebar, fullscreen, Cinema and pop-out. Follow duets, backing vocals, translations and romanization when available.
- **Personalize the lyrics view** with Canvas, animated album art, Space Gravity, Highlighter, custom fonts and pinned credits.
- **TTML Creator** lets you time words and syllables against a waveform or spectrogram, preview drafts and save them for a song. On supported clients, share Spotify audio to capture a spectrogram and play back recorded sections at a different speed.
- **Lyssna community lyrics** are available as a source. Connect your Lyssna account to submit a sync from Creator, share an existing TTML file with an Uploader account, or import lyrics locally for one song or in bulk.
- **Spotify enhancements** add a refined share menu, track metadata copying, a compact device picker and playlist menu options.
