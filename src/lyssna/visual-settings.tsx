import type { CSSProperties } from "react";
import { AnimatorPresetRow } from "./animator-settings";
import { DEFAULT_MARKER, MARKER_COLOURS } from "./highlighter";
import { SettingRow, Toggle } from "./setting-row";
import type { Settings } from "../settings";
type KeysOf<T> = { [K in keyof Settings]: Settings[K] extends T ? K : never }[keyof Settings];
type Flag = KeysOf<boolean>;
type Amount = KeysOf<number>;
export function visualRows(settings: Settings, onSettings: (patch: Partial<Settings>) => void, onManageAnimator: () => void) {
  const flag = (
    key: Flag,
    label: string,
    help: string,
    keywords = "",
    unavailable?: string,
  ) => (
    <SettingRow
      key={key}
      label={label}
      help={help}
      keywords={keywords}
      unavailable={unavailable}
    >
      <Toggle
        label={label}
        checked={!!settings[key]}
        onChange={(checked) => onSettings({ [key]: checked })}
      />
    </SettingRow>
  );
  /** A slider row; `off` hides it while the option it tunes is turned off. */
  const range = (
    key: Amount,
    label: string,
    help: string,
    keywords: string,
    [min, max, step]: [number, number, number],
    fallback: number,
    unit = "",
    off = false,
  ) => {
    if (off) return null;
    const value = settings[key] ?? fallback;
    return (
      <SettingRow key={key} label={label} help={help} keywords={keywords}>
        <span className="settings-range">
          <input
            type="range"
            aria-label={label}
            min={min}
            max={max}
            step={step}
            value={value}
            style={
              {
                "--fill": `${Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))}%`,
              } as CSSProperties
            }
            onChange={(event) =>
              onSettings({ [key]: Number(event.target.value) })
            }
          />
          <output>
            {value}
            {unit}
          </output>
        </span>
      </SettingRow>
    );
  };
  const lyricSize = settings.lyric_size || 36;
return { flag, range, Look: [
        <SettingRow
          key="size"
          label="Lyric text size"
          help="Make room for every word."
          keywords="lyrics size font scale"
        >
          <span className="settings-range">
            <input
              type="range"
              aria-label="Lyric text size"
              min="18"
              max="60"
              value={lyricSize}
              style={
                {
                  "--fill": `${((lyricSize - 18) / 42) * 100}%`,
                } as CSSProperties
              }
              onChange={(event) =>
                onSettings({ lyric_size: Number(event.target.value) })
              }
            />
            <output>{Math.round(lyricSize)}</output>
          </span>
        </SettingRow>,
        <SettingRow
          key="background"
          label="Background"
          help="Moving artwork, still artwork, the cover or the artist's header photo, one colour from the cover, or nothing behind the lyrics."
          keywords="background ambience dynamic static colour color"
        >
          <select
            className="settings-select"
            aria-label="Lyrics background"
            value={settings.lyrics_background ?? "animated"}
            onChange={(event) =>
              onSettings({
                lyrics_background: event.target
                  .value as Settings["lyrics_background"],
              })
            }
          >
            <option value="animated">Animated artwork</option>
            <option value="static">Still artwork</option>
            <option value="cover">Cover art</option>
            <option value="artist">Artist header</option>
            <option value="color">Cover colour</option>
            <option value="none">None</option>
          </select>
        </SettingRow>,
        range(
          "lyrics_background_blur",
          "Background blur",
          "Blur the Cover art and Artist header backgrounds.",
          "background blur cover artist header image",
          [0, 48, 1],
          0,
          " px",
          !["cover", "artist"].includes(settings.lyrics_background ?? ""),
        ),
        <SettingRow
          key="pinned-footer"
          label="Pinned Lyrics Footer"
          help="Keep source and community credits visible. Full also pins writers."
          keywords="pinned footer written by writers credits source community"
        >
          <select
            className="settings-select"
            aria-label="Pinned Lyrics Footer"
            value={settings.lyrics_pinned_footer ?? "off"}
            onChange={(event) =>
              onSettings({
                lyrics_pinned_footer: event.target
                  .value as Settings["lyrics_pinned_footer"],
              })
            }
          >
            <option value="off">Off</option>
            <option value="no_writers">No Writers</option>
            <option value="full">Full</option>
          </select>
        </SettingRow>,
        <SettingRow
          key="year"
          label="Release year position"
          help="Show the year before or after the artists beside the lyrics, or leave it out."
          keywords="year date metadata release hide"
        >
          <select
            className="settings-select"
            aria-label="Release year position"
            value={settings.lyrics_year_position ?? "left"}
            onChange={(event) =>
              onSettings({
                lyrics_year_position: event.target
                  .value as Settings["lyrics_year_position"],
              })
            }
          >
            <option value="off">Off</option>
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
        </SettingRow>,
], Display: [
        flag(
          "lyrics_seek_compensation",
          "Space Gravity seek fade-in compensation",
          "Clicking a floating word during playback seeks 300 ms early to give speakers time to fade in.",
          "seek fade in compensation click lyric early volume",
        ),
        flag(
          "romanized",
          "Show romanized lyrics",
          "Display Latin-alphabet readings. Supplied readings are preferred; automatic transliteration is approximate.",
          "romanization transliteration",
        ),
        flag(
          "romanization_below",
          "Romanization under each line",
          "Show the reading as a smaller row under the lyrics as written. Off puts it in place of the line. Space Gravity always shows it in place.",
          "romanization under below line reading row in place replace",
          settings.romanized
            ? undefined
            : "Turn on Show romanized lyrics first",
        ),
        flag(
          "lyrics_translations",
          "Show translations",
          "Show translations that come with the lyrics under each line.",
          "translation translate language",
        ),
        flag(
          "experimental_word_sync",
          "Experimental word sync",
          "Estimate word timing for line-synced or plain lyrics. Timing may be off.",
          "word timing estimate",
        ),
        flag(
          "lyrics_simple",
          "Simple lyrics mode",
          "Words fill with a softer gradient and rise gently, without the bounce and glow, and resting lines are dimmer.",
          "simple minimal animation",
        ),
        flag(
          "lyrics_minimal",
          "Minimal lyrics mode",
          "In full screen, sung lines fade away and the lines still to come stay dim.",
          "minimal fullscreen full screen hide sung",
        ),
        flag(
          "lyrics_visualiser",
          "Visualiser",
          "Show bars that move with the music behind the lyrics, coloured by the album cover.",
          "visualiser visualizer bars spectrum equalizer audio",
        ),
        settings.lyrics_visualiser
          ? range(
              "lyrics_visualiser_opacity",
              "Visualiser opacity",
              "How strongly the visualiser bars show behind the lyrics.",
              "visualiser visualizer opacity transparency bars",
              [5, 100, 5],
              40,
              "%",
            )
          : null,
        flag(
          "lyrics_keep_overlaps",
          "Keep overlapping lines",
          "In Minimal lyrics mode, a line sung over an earlier one stays dimmed instead of fading away.",
          "minimal overlapping lines background vocals keep",
        ),
        flag(
          "lyrics_early_scroll",
          "Early scroll",
          "Start moving to the next line a moment before it is sung.",
          "scroll ahead",
        ),
        range(
          "lyrics_early_scroll_ms",
          "Early scroll time",
          "How far ahead Early scroll moves to the next line.",
          "scroll ahead lead milliseconds",
          [0, 800, 10],
          200,
          " ms",
          !settings.lyrics_early_scroll,
        ),
        flag(
          "lyrics_smooth_scroll",
          "Smooth scrolling",
          "Glide between lines on a spring. Off uses plain smooth scrolling.",
          "smooth scroll spring glide",
        ),
        flag(
          "lyrics_follow_button",
          "Show scroll to active button",
          "While you scroll through lyrics, show a button that returns to the current line.",
          "scroll return follow current line button arrow",
        ),
        flag(
          "lyrics_right_align",
          "Right align lyrics",
          "Line lyrics up on the right instead of the left.",
          "alignment",
        ),
        flag(
          "lyrics_flip_duet",
          "Flip duet sides",
          "Swap which side each duet voice sits on.",
          "duet opposite alignment",
        ),
        flag(
          "lyrics_wide_duet",
          "Wide duet line padding",
          "Separate duet voices into wider columns.",
          "duet padding",
        ),
        flag(
          "lyrics_credits_follow",
          "Credits follow the last singer",
          "Put the credits on the side of the song's last line, so a duet ending on the right keeps them there.",
          "credits duet side align right",
        ),
        flag(
          "lyrics_line_hover",
          "Line hover background",
          "Highlight a line when you point at it.",
          "hover highlight",
        ),
        flag(
          "lyrics_skeleton",
          "Lyrics loading skeleton",
          "Show placeholder lines while lyrics load, instead of a message.",
          "loading placeholder skeleton",
        ),
        flag(
          "lyrics_no_lyrics_notice",
          "No lyrics notice",
          "Say when a song has no lyrics. Off shows only the song; problems reaching a source still show.",
          "no lyrics notice message unavailable missing",
        ),
], Effects: [
        flag(
          "space_gravity",
          "Space Gravity",
          "Words float in zero gravity, drift as they're sung and react when you move the window.",
          "gravity float",
        ),
        flag(
          "lyrics_highlighter",
          "Highlighter",
          "A marker pen sweeps behind each line as it's sung, row by row, and over each floating word in Space Gravity.",
          "highlighter marker highlight pen lyrics player style",
        ),
        settings.lyrics_highlighter ? (
          <MarkerColourRow
            key="highlighter-colour"
            value={settings.lyrics_highlighter_color ?? DEFAULT_MARKER}
            onChange={(lyrics_highlighter_color) =>
              onSettings({ lyrics_highlighter_color })
            }
          />
        ) : null,
        ...(settings.lyrics_highlighter && settings.space_gravity
          ? [
              flag(
                "gravity_links",
                "Connecting lines",
                "In Space Gravity, a marker line joins each sung word to the next.",
                "highlighter space gravity line link connect brainstorm",
              ),
              range(
                "gravity_link_width",
                "Connecting line thickness",
                "How broad the lines are, as a share of the Highlighter's band.",
                "highlighter space gravity line link thickness width",
                [10, 100, 5],
                100,
                "%",
                settings.gravity_links === false,
              ),
            ]
          : []),
        <AnimatorPresetRow
          key="animator"
          animator={settings.lyrics_animator}
          onChange={(lyrics_animator) => onSettings({ lyrics_animator })}
          onManage={onManageAnimator}
        />,
        <SettingRow
          key="word-filter"
          label="Unique word filters"
          help="Show every lyric word in lower case or upper case, or respell lyrics as gibberish the way they sound."
          keywords="word filter lowercase uppercase case meme gibberish wenomechainsama"
        >
          <select
            className="settings-select"
            aria-label="Unique word filters"
            value={settings.lyrics_word_filter ?? "off"}
            onChange={(event) =>
              onSettings({
                lyrics_word_filter: event.target
                  .value as Settings["lyrics_word_filter"],
              })
            }
          >
            <option value="off">Off</option>
            <option value="gibberish">Gibberish</option>
            <option value="lower">all lowercase</option>
            <option value="upper">ALL UPPERCASE</option>
          </select>
        </SettingRow>,
        flag(
          "canvas_lyrics",
          "Canvas in lyrics",
          "Play the track's Canvas when Spotify makes it available.",
          "video background",
        ),
        flag("animated_covers", "Animated covers", "Play Apple Music motion covers in Lyrics, the playbar and Now Playing when available.",
          "motion artwork animated album cover video apple music"),
        flag(
          "npv_ambience",
          "Dynamic background in Now playing",
          "Draw the moving artwork, or the Canvas, behind the Now playing panel.",
          "now playing sidebar ambience background dynamic",
        ),
        flag(
          "glass_seek",
          "Glass seek bar",
          "Give the full screen seek bar a frosted glass track and a glowing fill.",
          "seek bar slider progress glass styling fullscreen full screen",
        ),
        flag(
          "cover_animation",
          "Cover art animation",
          "Crossfade the artwork beside the lyrics when the song changes.",
          "cover artwork album fade transition",
        ),
], Layout: [
        flag(
          "lyrics_compact",
          "Compact lyrics",
          "Use the narrow lyrics layout at any window size.",
          "narrow layout",
        ),
        flag(
          "lyrics_hide_artwork",
          "Hide artwork",
          "Show only the lyrics, without the album cover.",
          "cover",
        ),
        flag(
          "lyrics_artwork_right",
          "Artwork on the right",
          "Put the album cover on the right of the lyrics.",
          "cover side swap",
        ),
        flag(
          "lyrics_up_next",
          "Show Up next",
          "Show the next song beside the lyric credits during the last 30 seconds. Click it to skip to that song.",
          "queue next song upcoming",
        ),
        <SettingRow
          key="toolbar-position"
          label="View controls position"
          help="Where the lyrics toolbar sits outside full screen."
          keywords="toolbar view controls top bottom position"
        >
          <select
            className="settings-select"
            aria-label="View controls position"
            value={settings.lyrics_toolbar_bottom ? "bottom" : "top"}
            onChange={(event) =>
              onSettings({
                lyrics_toolbar_bottom: event.target.value === "bottom",
              })
            }
          >
            <option value="top">Top</option>
            <option value="bottom">Bottom</option>
          </select>
        </SettingRow>,
        <SettingRow
          key="always-show"
          label="Always show in full screen"
          help="Keep the playback controls, the time, or both on screen instead of hiding them when the mouse rests."
          keywords="fullscreen full screen controls time seek hide idle"
        >
          <select
            className="settings-select"
            aria-label="Always show in full screen"
            value={settings.fullscreen_always_show ?? "none"}
            onChange={(event) =>
              onSettings({
                fullscreen_always_show: event.target
                  .value as Settings["fullscreen_always_show"],
              })
            }
          >
            <option value="none">None</option>
            <option value="controls">Controls</option>
            <option value="time">Time</option>
            <option value="both">Both</option>
          </select>
        </SettingRow>,
        <SettingRow
          key="fullscreen-volume"
          label="Full screen volume slider"
          help="Add a volume slider to the full screen controls."
          keywords="fullscreen full screen volume slider sound"
        >
          <select
            className="settings-select"
            aria-label="Full screen volume slider"
            value={settings.fullscreen_volume ?? "off"}
            onChange={(event) =>
              onSettings({
                fullscreen_volume: event.target
                  .value as Settings["fullscreen_volume"],
              })
            }
          >
            <option value="off">Off</option>
            <option value="left">Left</option>
            <option value="right">Right</option>
            <option value="below">Below</option>
          </select>
        </SettingRow>,
        <SettingRow
          key="escape"
          label="Escape key function"
          help="What Escape does on the lyrics page: leave full screen only, or leave the lyrics too."
          keywords="escape key esc exit fullscreen full screen lyrics close"
        >
          <select
            className="settings-select"
            aria-label="Escape key function"
            value={settings.lyrics_escape_exits ? "fully" : "fullscreen"}
            onChange={(event) =>
              onSettings({
                lyrics_escape_exits: event.target.value === "fully",
              })
            }
          >
            <option value="fullscreen">Exit full screen</option>
            <option value="fully">Exit fully</option>
          </select>
        </SettingRow>,
        flag(
          "fullscreen_animate_close",
          "Animate closing full screen",
          "Slide the lyrics away before full screen closes.",
          "fullscreen full screen close exit animation slide",
        ),
        flag(
          "lyrics_hide_npv",
          "Hide lyrics in Now playing",
          "Never show the lyrics card in the Now playing panel.",
          "now playing card sidebar",
        ),
        flag(
          "lyrics_hide_npv_empty",
          "Hide the Now playing card without lyrics",
          "Remove the lyrics card when the current song has no lyrics.",
          "now playing card empty",
        ),
  ] };
}
function MarkerColourRow({
  value,
  onChange,
}: {
  value: string;
  onChange: (colour: string) => void;
}) {
  const preset =
    value === "cover" || MARKER_COLOURS.some(([hex]) => hex === value)
      ? value
      : "custom";
  return (
    <SettingRow
      label="Marker colour"
      help="The Highlighter's ink. Cover colour follows the artwork; Custom takes any colour."
      keywords="highlighter marker colour color ink custom cover"
    >
      <span className="marker-colour">
        <select
          className="settings-select"
          aria-label="Marker colour"
          value={preset}
          onChange={(event) =>
            onChange(
              event.target.value === "custom"
                ? value === "cover"
                  ? DEFAULT_MARKER
                  : value
                : event.target.value,
            )
          }
        >
          {MARKER_COLOURS.map(([hex, name]) => (
            <option key={hex} value={hex}>
              {name}
            </option>
          ))}
          <option value="cover">Cover colour</option>
          <option value="custom">Custom</option>
        </select>
        <input
          type="color"
          aria-label="Custom marker colour"
          value={value === "cover" ? DEFAULT_MARKER : value}
          disabled={value === "cover"}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
    </SettingRow>
  );
}
