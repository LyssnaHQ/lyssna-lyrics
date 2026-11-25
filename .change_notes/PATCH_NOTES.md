# Lyssna Lyrics patch notes

## v1.2.0

### Recording and spectrograms

- **Sharper live spectrograms.** Live Spotify captures use the same frequency analysis as imported audio, with finer time and frequency detail. Zoom in to see transients more clearly. Replaying a captured section preserves the detail already saved.
- **Record at your listening volume.** Lyssna applies gain before converting quiet captures to 24-bit audio. Video capture is minimized during Spotify screen sharing and its output is disabled once Lyssna verifies the Spotify window.
- Audio capture keeps saving while compression runs in the background, reducing recording gaps when Spotify lags. Open **Saved audio → Skip to missing** to jump to the next unrecorded section.
- The spectrogram gain slider now centers at **0.5×**. Choose a palette or edit its color stops, preview the gradient, and export PNGs with those colors.
- If you have older spectrograms saved, Lyssna offers to clear them once so you can regenerate them at the new quality. The cleanup keeps your recordings and lyrics.

### Spotify Local Files

- **Open lyrics and Creator for local tracks.** Import TTML or LRC, save a draft per track, or match the recording to look up lyrics and submit a sync by ISRC. Confirm a suggested match, paste a Spotify track link, or enter a known ISRC.
- Play unavailable Spotify playlist tracks using a verified local replacement. Playback continues in the playlist’s displayed order, with the source playlist and current row highlighted. Row numbers stay visible until you hover or focus the playback control.
- Embedded local covers now supply the artwork and background colors. Lyssna can also recover the cover from Spotify’s playbar or use an animated placeholder palette when artwork is missing. Up Next uses alternate art or a placeholder if its image fails.

### Lyrics, translations, and credits

- Choose a source for the current song from the lyrics toolbar. Lyrics reload as soon as you select it, even with a Creator preview open. The refresh icon spins while loading. **Clear Cache** also resets per-song source choices and checks for fresh lyrics.
- lrc.red is enabled by default. Its word sync can take priority over line-synced Apple Music lyrics, and parenthesized lines and timed backing vocals keep their order and spacing. Lyssna can also fetch Spotify lyrics directly and check alternate ISRCs and recording lengths when looking up Apple Music syncs.
- **Show translations** uses Google Translate for online lyrics with missing translations. Supplied translations also appear in Space Gravity and Reviewer and survive estimated word timing.
- Lyssna’s romanization engine reads Japanese in context and preserves word timing. The lyrics view follows the latest lead vocal, so backing vocals can animate without pulling the lyrics away from it.
- Community contributors appear first. Apple Music receives sync credit when its timing is retained and can supply missing songwriter names while you use another source. The pinned footer defaults to **No Writers** and includes **Written by** at the bottom when all lyrics fit on screen.
- Spotify Canvas shows a still frame when lyrics open while paused. Album art fills in while Canvas loads. Instrumental tracks get a message in your lyrics font, and an approved lyric upload clears the instrumental mark.
- Request lyrics from the missing-lyrics screen. Submissions can include alternate ISRCs and artwork from local tracks.

### TTML Creator

- **Preview live edits in Cinema or the lyrics pop-out with Creator still open.** Both views follow Creator playback, and playback redraws were reduced when using the editor and pop-out together.
- Review proposed Genius changes before applying them. Edit section headings, pick common section names, carry singers into new sections, and edit or time parts of romanized readings. Draft and backing-vocal actions are available in the combined editor view.
- Imported commas and other trailing punctuation stay attached to the preceding word. Undo and redo shortcuts work again, and advancing with G or H keeps the next word visible. The playhead freezes on pause and timing highlights respond immediately.
- Space pauses and resumes the audio selected in Creator. Spotify stays paused while Creator uses recorded or imported audio.
- Creator toolbar buttons show labels when there’s room. You can clear the draft or reset it to the best available source, with undo for a reset. Creator tells you when it’s already showing the source.
- Successful submissions close Creator and return to source lyrics. Approved lyrics refresh immediately and show a short confetti burst. Upload errors keep Creator open and show a centered red notice with a brief shake. Both animations respect reduced motion.

### Settings and Spotify Tweaks

- Settings groups related controls into sections and puts short toggles side by side when space allows. Search results show their tab and section. Effects and Advanced each have their own tab, and hidden settings can be edited directly in **Manage Hidden Settings**.
- **Build Channels** opens from the button left of Search Settings. Saved hidden builds appear below Canary and can be switched to or removed. The key field is always visible in the popup.
- New users can choose Lyssna’s suggested Spotify Tweaks before Welcome. Existing users can keep their tweaks or disable them. **Enhance Spotify Performance** stays on either way.
- **Copy/Share** includes track ID, ISRC, song and artist, clean link, and embed. Copy actions also work when Spotify skips the menu for an unavailable track. Profile menu cleanup, playlist covers, folder selection, and playlist search work with Spotify’s updated menus.
- The Tools tab preloads your profile and refreshes it in place. Admins can search for an upload account by name or ID and stop uploading as that account from the same row. **Add ISRC Links** sits beside Profile.
- Canary update notices show the changes from each skipped build. Stable startup can use a previously saved manifest when a fresh one is unavailable.

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
