# Lyssna Lyrics patch notes

## v1.2.0-262eb70

- Move the lyrics scrollbar to the right edge and reveal its thumb when you hover nearby. Lyssna’s other scrollbars show only the thumb.
- While uploading as another Lyssna account, show its avatar in Spotify’s profile button. Choose **Stop uploading as** from the profile menu to switch back.

## v1.2.0-3b92380

- Show play and pause feedback immediately in Creator. Rapid presses keep the final playback choice, and the playhead updates as soon as a seek takes effect.
- Reduce rendering work during playback and batch draft saves during quick edits.
- Add a thin, translucent scrollbar to the lyrics view. Drag it to browse the song.

## v1.2.0-63d18f0

- Omit cover artwork URLs from Creator’s TTML metadata.
- Keep Creator’s header buttons right-aligned when the toolbar wraps.

## v1.2.0-1c6f259

- Fill available Spotify track and release details in Creator’s TTML metadata, including ISRC, release date, track and disc numbers, and label.
- Fill Creator’s songwriter field from Apple Music, with Spotify’s Lyricists as the fallback. Existing metadata edits are preserved.

## v1.2.0-54789d0

- Show songwriter credits from Lyssna’s song record when its lyrics file leaves them out. Use Apple Music or Spotify credits when the selected source has no writers.

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

## v1.1.0-25fe0a7

- Make Space pause and resume the audio selected in Creator. Keep Spotify paused while Creator uses recorded or imported audio.

## v1.1.0-623e874

- Remove the top-left glow from the Build Channels popup.

## v1.1.0-42f00d0

- Put the Build Channels button to the left of Search Settings.

## v1.1.0-6309b05

- Move Build Channels beside Search Settings and remove the settings footer.
- Widen Build Channels, list saved hidden builds below Canary, and keep the hidden build key field visible.

## v1.1.0-3568e78

- Put matching accounts beside the admin search field. Include the account name on the stop button.

## v1.1.0-a9be0dd

- Put the admin upload account search beside its label in Settings.

## v1.1.0-ae11d11

- Keep “Written by” with the pinned footer when all lyrics fit on screen.

## v1.1.0-f8bdf05

- Briefly shake Creator upload errors when they appear, unless reduced motion is enabled.

## v1.1.0-2a20e16

- Add a red glow around Creator upload errors so they stand out against the editor.

## v1.1.0-eec63ae

- Raise Creator upload errors by 40 pixels to clear the playback controls.

## v1.1.0-2e647bc

- Center upload errors in the Spotify window while keeping Creator open. Raise successful upload notices by 20 pixels.

## v1.1.0-d7863c2

- Center Lyssna upload confirmations in the Spotify window. Show a short confetti burst when an upload goes live unless reduced motion is enabled.

## v1.1.0-afd5bc9

- Put Copy ID, Copy ISRC, and Copy Song Name & Artist first in Copy/Share, followed by Copy Clean URL and Embed.

## v1.1.0-eb2cd17

- Use Google Translate for online lyric lines with no supplied translation when Show translations is enabled.
- Edit hidden settings in Manage Hidden Settings while keeping them hidden from their usual tabs.
- Move Copy Clean URL and Embed into Copy/Share and give both actions distinct icons.
- Use alternate artwork or a cover placeholder when the Up Next image fails to load.

## v1.1.0-c769dad

- Give the settings hide buttons a circular outline that matches the other controls.

## v1.1.0-22dbc76

- Restore Effects and Advanced as separate tabs. Keep account and Creator tools under Tools.
- Preload the Tools account profile and refresh it in place. Put the admin Add ISRC links button beside Profile.
- Keep hidden builds in Build Channels for switching or removal. Default the pinned lyric footer to No Writers.
- Show supplied translations in Space Gravity and Reviewer mode and preserve them when estimating word timing.

## v1.1.0-45bbd4f

- Organize Settings into Appearance, Lyrics, Views, Spotify Tweaks, Sources, and Tools. Group related controls and show short switches side by side when space allows.
- Open playlist folder choices on demand. Search results show their tab and section, and the build version in the footer opens Build Channels.

## v1.1.0-b97f678

- Reset per-song source choices with Clear Cache and check for fresh lyrics.
- Return to source lyrics after a successful Creator upload. Refresh approved lyrics immediately and show draft preview again when you make a new edit.

## v1.1.0-8e3aa2f

- Show Already showing source when a TTML Creator draft already matches its lyric source.

## v1.1.0-86623eb

- Attach commas and other trailing punctuation to the previous word when loading TTML into Creator, preserving the word timing.

## v1.1.0-5e42cfc

- Fill missing songwriter credits from Apple Music when enabled, while keeping the selected lyrics and timing.

## v1.1.0-a7b5edc

- Keep standalone parenthesized lrc.red lyrics in their original order and preserve word spacing in timed backing vocals.

## v1.1.0-c4b73ed

- Open Build Channels in a compact popup over Settings.
- Enable lrc.red by default and prefer its word sync over line-synced Apple Music lyrics.

## v1.1.0-c723f87

- Refresh lyrics as soon as you choose a source, including when a Creator draft was showing.
- Spin the refresh icon while lyrics are loading in place of the refresh popup.
- Credit Apple Music for retained timing and list community contributors first.

## v1.1.0-a5d8062

- Show text labels beside TTML Creator toolbar icons when the editor is wide enough.

## v1.1.0-ec2890c

- Use the selected lyrics font for the instrumental message.

## v1.1.0-78f01b5

- Show a small instrumental message at the bottom of the lyrics page, below the controls.
- Remove the Unmark instrumental button. Approved lyric uploads clear instrumental marks.

## v1.1.0-f90ac04

- Choose a lyric source for the current song from the lyrics toolbar.

## v1.1.0-df13d0d

- Keep the latest lead line centered so backing vocals can animate without pulling the lyrics out of place.

## v1.1.0-8f50186

- Show changes from every skipped Canary build, grouped by version, before and after updating.

## v1.1.0-6417e53

- Move the first-run preview out of Settings. Open it from Spotify DevTools with `LyssnaLyrics.showFirstRun()`.

## v1.1.0-c1247be

- Preview the first-run Spotify Tweaks and Welcome prompts under Advanced settings without changing preferences.
- Start sections with the previous singers, edit section headings, and pick common section names.
- Edit romanized readings in place or split them from the word menu. Show draft and backing-vocal actions in the combined Creator view.

## v1.1.0-d9dce5a

- Choose Spotify Tweaks before Welcome. Existing users can keep or disable their tweaks. Enhance Spotify Performance stays on either way.
- Offer a one-time cleanup for older saved spectrograms. Audio recordings and lyrics stay saved.
- Review Genius changes, edit song sections, clear Creator drafts, and time individual pieces of romanized readings.
- Choose a lyric source per song, use Spotify lyrics directly, and retry temporarily unavailable Apple Music lyrics.
- Request lyrics, flag instrumentals, and include alternate ISRCs and local artwork in submissions.
- Bring desktop lyric motion, early backing-vocal timing, and animated cover colors to the lyrics view.

## v1.1.0-ca9f2e1

- Keep measured spectrogram detail in place during repeated Spotify captures.
- Add Skip to missing to the Saved audio menu for partial recordings.
- Save audio before background compression to avoid gaps from slow encoding. Minimize video capture and disable its output after verifying Spotify.
- Smooth the placeholder music note and use a fresh cover palette in the lyrics background.

## v1.1.0-8ea975d

- Center the spectrogram gain slider at 0.5×, with finer steps and lower gain options.

## v1.1.0-652ec91

- Show a random Spotify Canvas frame when lyrics open paused. Use album art for the lyrics background while Canvas loads.

## v1.1.0-d2cb71a

- Sharpen live spectrograms with the same frequency analysis as imported audio and twice the time samples.
- Preserve more detail when recording at low Spotify volume by applying gain before 24-bit conversion.

## v1.1.0-4efa155

- Scroll to the newest active lyric when vocal lines overlap.

## v1.1.0-4f8aad2

- Keep matched local row numbers clear and reveal a single playback control on hover or keyboard focus.
- Show the green title and speaker in Your Library during matched local playlist playback.

## v1.1.0-df43dc2

- Rebuild local playlist playback around explicitly selected matches, preserving row numbers, the active playlist indicator, and continuation through the displayed order.
- Require a unique recording match for local playlist playback and Load TTML suggestions.

## v1.1.0-5dcbcd9

- Keep playlist numbers visible until hover or keyboard focus. Show the active playlist and highlight its current row during local playback.
- Continue in the playlist's displayed sort order when starting a matched local track.

## v1.1.0-2ba39ca

- Find more Apple Music syncs by checking alternate ISRCs and matching the recording length. Search Apple by title and artist when ISRCs miss.
- Let admins find upload accounts by name or ID, with reserved accounts listed first.

## v1.1.0-46d7c64

- Play the selected local match when opening an unavailable playlist track. Keep row numbers visible until hover or keyboard focus.

## v1.1.0-3fd9b63

- Show unavailable playlist tracks with a verified local replacement at normal brightness.
- Keep the source playlist active in the Spotify sidebar when a local replacement plays.

## v1.1.0-7d60b2b

- Keep the next word visible and clearly outlined when advancing with G or H in TTML Creator.

## v1.1.0-c14783b

- Play ISRC-matched local files in place of unavailable Spotify playlist tracks.

## v1.1.0-5e689b7

- Recover missing local artwork from the Spotify playbar when it shows the same track.
- Show a generic cover in lyrics and TTML Creator previews when artwork is unavailable.

## v1.1.0-4811c8d

- Match local files using Spotify album links and look up tracks directly when they’re missing from search.

## v1.1.0-f76afdf

- Move local recording matching below Submit to Lyssna. Confirm a suggested recording or enter a known ISRC.
- Match the TTML Reviewer dropdown to the main settings and give its row an outline.

## v1.1.0-2c9b25c

- Recover Apple Music lyrics when one Lyssna lookup returns a cached miss. Refresh lyrics also bypasses cached misses.

## v1.1.0-b303856

- Try MusicBrainz when catalogue searches miss an ISRC for a local file.
- Match untagged local files in Load TTML using a verified ISRC or Spotify track link.

## v1.1.0-ec38f4e

- Enable lyrics lookup and uploads by ISRC for matched local files, with a Lyssna search fallback.

## v1.1.0-0a47ee9

- Restore animated backgrounds and accent colours for embedded covers served as localfileimage URLs.

## v1.1.0-926230f

- Match Spotify Local Files by title, artist, and duration to look up lyrics by ISRC.
- Use embedded local cover art for lyrics backgrounds and colours.

## v1.1.0-340cba1

- Reset TTML Creator drafts to the best available lyric source. Undo restores the previous draft.
- Show the visualizer in artwork-only views and use saved spectrograms when Spotify omits pitch data.

## v1.1.0-b365ce2

- Freeze the TTML Creator playhead on pause and suspend Spotify playback transitions during editing.
- Remove word highlight fades and spectrogram scroll easing.
- Sharpen spectrogram zoom and improve transient detail.

## v1.1.0-711a77b

- Let admins find registered or reserved upload accounts by username or user ID.

## v1.1.0-9989e9b

- Open Copy actions, including Copy ISRC, when Spotify skips the menu for an unavailable track.
- Restore undo and redo shortcuts in TTML Creator.

## v1.1.0-9dfcf39

- Show Spotify Local Files in Lyssna Lyrics. Search supported sources or import TTML and LRC files, and save Creator drafts per local track.

## v1.1.0-8f8f2ed

- When Apple Music is credited, show contributor names based on their share of the timing.

## v1.1.0-d2473f9

- Count word and timing shares toward the 30% threshold for showing contributor names.

## v1.1.0-74701cb

- Show the second contributor’s name when their share is at least 30%, including on syncs with Apple Music credit.
- Control Creator’s reduced redraw mode with Enhance Spotify Performance.

## v1.1.0-f503e9a

- Reduce stutter when using lyrics popouts alongside TTML Creator by cutting editor and lyrics redraws during playback.

## v1.1.0-6023392

- Record spectrograms with twice the frequency and time detail. Existing captures still open and export.

## v1.1.0-fa2d86a

- Align Cinema Lyrics playback controls with the cover and keep lyrics and credits clear of the draft banner.

## v1.1.0-c35a802

- Open Cinema Lyrics or the lyrics popout while keeping TTML Creator open. Both windows show live draft edits and follow Creator playback.
- Customize spectrogram colors with new palettes, a gradient preview, and editable color stops. Exported spectrograms use the selected palette.
- Highlight active words in the editor with steady green instead of a white flash.

## v1.1.0-1944c8a

- Use Lyssna’s romanization engine in Spotify lyrics and TTML Creator. Read Japanese in context and keep word timing when showing readings.

## v1.1.0-7baebb7

- Hide the loading spinner in the profile menu when Your Updates is hidden.

## v1.1.0-7394a94

- Fade the active lyric line’s glow in and out on hover.

## v1.1.0-38abe2f

- Hide Your Updates and its divider on the new profile menu. Apply profile menu cleanup before either menu layout becomes visible.

## v1.1.0-690e080

- Restore submenu arrows and remove horizontal scrolling from the playlist popout.

## v1.1.0-ba90cec

- Restore profile menu cleanup, Copy and Share actions, and playlist covers and folder selection on Spotify’s updated menus. Older Spotify menus remain supported.
- Keep Spotify’s playlist search accessible when using selected folders.

## v1.0.1-5724bc2

- Increase overlap between contributor avatars.

## v1.0.1-a34a54f

- Stack contributor avatars closer together. Click the Apple Music credit or avatar to open the song’s Lyssna page.

## v1.0.1-243b01f

- Show Apple Music’s avatar first on Apple-based syncs. Editors under 30% stay in the avatar stack with their names hidden from the contributor line.

## v1.0.1-430e177

- Match Creator edits to an original Apple Music revision only when the original has word timing.

## v1.0.1-0e2fc85

- Enable Apple Music edit uploads through the live Lyssna submission API.

## v1.0.1-8b82b40

- Wrap long song titles in the Saved audio popover and keep the controls inside its width.

## v1.0.1-777aaf8

- Keep the original Apple Music sync in Lyssna song history when an edit from Creator is the first submission.

## v1.0.1-0768c1e

- Prefer word-synced Apple Music lyrics through Lyssna. Use Spicy Lyrics community syncs when they have word timing and Apple Music has line timing or less.

## v1.0.1-9235500

- Restore the sidebar layout and styling when opening the review queue from the Spotify top bar.

## v1.0.1-2747798

- Keep the lyrics toolbar on one row, with horizontal scrolling when space runs out.

## v1.0.1-dacfcf4

- Prefer Lyssna for Apple Music syncs. Use Spicy Lyrics for Apple Music only when the Lyssna lookup is unavailable.

## v1.0.1-4fb5f28

- Shorten the source name to Apple Music in Manage Sources.
- Remove the separate Apple Music priority toggle. The source list controls lookup order.

## v1.0.1-01eb257

- Show “Lyrics provided by: Apple Music (via Lyssna)” for Apple Music lyrics supplied by Lyssna.

## v1.0.1-d0016ea

- Keep fullscreen playback buttons at full brightness when the pointer is over the gaps between them.
- Respect the fullscreen visibility setting on instrumental tracks and tracks without lyrics.

## v1.0.1-8597efa

- Center album artwork for instrumental tracks in the regular and fullscreen lyrics views.

## v1.0.1-8ed7ccd

- Match the Lyssna app when a song has no lyrics. Search again, import a lyric file, or open TTML Creator from the screen.
- Center and resize the cover in fullscreen when a song has no lyrics. Restore the fullscreen transport, heart, and glass volume styling.

## v1.0.1-0a9e5f7

- Fetch Apple Music lyrics through Lyssna and label Apple Music lyrics with the service that supplied them.
- Let TTML Creator start from Apple Music lyrics supplied by Lyssna.
- Let reviewers mark recordings instrumental by ISRC from the missing-lyrics screen.

## v1.0.1-0f13892

- Fix Delete for selected words and lines when Spotify only delivers the key release.

## v1.0.1-d0b7c50

- Delete removes the selected word or the full line when the row is selected.

## v1.0.1-5f7d6c1

- Give selected TTML rows keyboard focus so Delete removes the whole line. Delete also removes the active line when a timing word is focused.

## v1.0.1-4f4b748

- Click a line in TTML Creator and press Delete to remove the whole line.

## v1.0.1-bd1535c

- Stop manual scrolling at the songwriter credits when the rest of the footer is pinned.
- Use the first About gallery photo in Now Playing and move the artist name, listeners, and Follow button over it.

## v1.0.1-977c012

- Keep pinned credits with the lyrics column when swapping artwork sides in Space Gravity.

## v1.0.1-5778e5c

- Apply Liquid Glass to the lyrics controls pill and its expanded quick settings.

## v1.0.1-fce80fe

- Match the first-upload notice to Load TTML, including Liquid Glass.
- Keep the lyrics toolbar in place when swapping artwork and lyrics.

## v1.0.1-afc796f

- Show the Lyssna terms before your first lyrics upload from TTML Creator or Load TTML. The notice explains why published syncs stay available for community edits.

## v1.0.1-ffbbe4e

- Animate the artwork and lyric columns when swapping sides.
- Keep the Lyssna song page open while Spotify changes tracks.
- Match the Lyssna desktop app’s fullscreen and cinema playback controls.
- Remove the theme selector from Appearance and match Animator Behavior sliders to Settings.

## v1.0.1-d21a8de

- Fetch community, Apple Music, and Spotify syncs directly through the official Spicy Lyrics API. Lyrics still show the provider and linked community credits.

## v1.0.1-2d1fc34

- Show one recording meter in the editor and bring the same recording, export, and storage actions to the Spotify playbar.
- Protect saved audio and spectrograms from later captures once a song is fully recorded.

## v1.0.1-f4e337c

- Songs without lyrics now offer TTML Creator and the Lyssna Discord. Fullscreen and Cinema center the album cover.
- The Review button opens the queue on the current page. Select a submission to open Creator.
- Hide Spotify’s extra hover fill while dragging the optimized volume slider.

## v1.0.1-91bcf0b

- Added Enhance Spotify Performance in Spotify Tweaks. It smooths volume drags and groups playbar and sidebar updates. Enabled by default.
- Reduced redundant Highlighter redraws during lyric animation.
- Added Bouncy Lyrics to Animator Presets.

## v1.0.1-d3e3ce2

- The Highlighter stays connected as words bounce in the regular lyrics view.

## v1.0.1-d7cb49e

- Space Gravity trails keep up to 10 words or 2.28 seconds of ink, whichever limit comes first. The tail retracts as the next word joins.

## v1.0.1-bccde58

- Space Gravity trails keep about 2.3 seconds of ink before the tail catches up.

## v1.0.1-6b980ad

- Space Gravity trails retract from the tail sooner. Crossing strokes darken where they overlap.
- Lyrics loading bars stay translucent with the visualizer on.

## v1.0.1-e7c0923

- The continuous Space Gravity trail glides into the next word while staying connected.
- The song-timed Highlighter layer is stronger on connected words.

## v1.0.1-e23400c

- Space Gravity draws an unbroken Highlighter trail beneath each connected group of words. The word highlight follows the song above it.
- Pinned settings expand beside their own icons. Click the same icon to close its picker, or click another to switch.

## v1.0.1-b94bcad

- Space Gravity's Highlighter trails tuck under the ink at both words and follow the painted edge during early handoffs.

## v1.0.1-6a27576

- The Hide artwork icon's divider slides with its chevron on hover and keyboard focus.

## v1.0.1-33ebb72

- Pinned pickers extend along the toolbar, sideways for a horizontal pill and vertically for a compact pill.
- Toolbar icons move once on hover or keyboard focus, then return to rest when it ends.

## v1.0.1-791afd4

- Pin Lyrics font from Appearance. Choose a font or switch back to Default while keeping your custom choice. The app font has its own switch.
- Pinned pickers expand the lyrics toolbar with the other controls still visible. All pinned icons animate on hover and keyboard focus when Reduce Motion is off.

## v1.0.1-ebeea20

- Pin Animator Presets and Unique word filters from Effects. Choose a preset or filter directly in the lyrics toolbar.

## v1.0.1-acda0c4

- Animator Behavior docks inside the lyrics area, clear of Spotify's sidebar. Preset controls stack when the panel is narrow.

## v1.0.1-9da80b9

- Adjust Word density in Effects when Space Gravity is on. 100% keeps the previous density.

## v1.0.1-4831237

- Standalone backing vocals in Space Gravity get their own Highlighter trails. Each trail ends with its phrase.
- The visualizer uses fewer layout reads, and Space Gravity does less work per frame when words drift and trails follow them.

## v1.0.1-704bb1f

- Space Gravity's marker trails ripple as words move. Both ends stay lined up with the ink.
- Early Highlighter handoffs use two layers. The base trail moves ahead while a brighter pass follows the word's original timing.
- Pin Visualiser to the lyrics toolbar from settings.

## v1.0.1-f350516

- Visualizer bars launch individual Space Gravity words on contact. Rising bars hit harder, and off-center hits send the word up at an angle.
- Highlighter's opening mark and painted tails stay attached to moving words. Connecting strokes follow both words as they drift and spin.
- The marker starts longer trips earlier and eases into the next word.

## v1.0.1-dffb46b

- Visualizer uses 48 bars at half the previous height. Space Gravity lyrics bounce with the beat.
- Highlighter hands off sooner between closely spaced words. The live stroke follows word motion, including custom animator springs.
- Manage Stored Data uses saved byte counts and lists recordings, spectrograms, and animated covers for individual deletion. With exports enabled, download audio, spectrogram PNGs, or cover videos.
- Canary update notices show the matching build notes from the Lyssna Lyrics website.

## v1.0.0

### A fresh start, I wonder what adventures await us?

- **Word-synced lyrics** in Spotify’s main view, Now Playing sidebar, fullscreen, Cinema and pop-out. Follow duets, backing vocals, translations and romanization when available.
- **Personalize the lyrics view** with Canvas, animated album art, Space Gravity, Highlighter, custom fonts and pinned credits.
- **TTML Creator** lets you time words and syllables against a waveform or spectrogram, preview drafts and save them for a song. On supported clients, share Spotify audio to capture a spectrogram and play back recorded sections at a different speed.
- **Lyssna community lyrics** are available as a source. Connect your Lyssna account to submit a sync from Creator, share an existing TTML file with an Uploader account, or import lyrics locally for one song or in bulk.
- **Spotify enhancements** add a refined share menu, track metadata copying, a compact device picker and playlist menu options.
