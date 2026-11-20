import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Music2 } from "lucide-react";
import { LyricAnimator } from "./lyric-animator";
import { presetOf } from "./animator-tuning";
import { frameDue } from "./frame-cap";
import { HighlighterWords, markerColour } from "./highlighter";
import { LyricCountdown } from "./lyric-countdown";
import { LyricWord } from "./lyric-word";
import { glideScroll, GLIDE_MS, lineBlur, stepScroll, tuneMotion, vocalEnd, vocalGap, vocalGaps, wordGroups, type ScrollSpring, type VocalGap } from "./lyric-motion";
import type { Line, Lyrics, Word } from "./types";
import type { Settings } from "../settings";
import { LyricCredits } from "../credits";

export function activeLines(
  lines: { start_ms: number; end_ms: number; words?: Word[] }[],
  time: number,
): number[] {
  return lines.flatMap((line, index) =>
    line.start_ms <= time &&
    time <
      (line.words?.length
        ? Math.max(...line.words.map((word) => word.end_ms))
        : line.end_ms)
      ? [index]
      : [],
  );
}
/**
 * Whether the last lead line sits on the right, so credits can follow the
 * last singer. Duet lines sit right unless the sides are mirrored by Flip
 * duet sides or Right align lyrics.
 */
export function endsOnRight(
  lines: { background: boolean; opposite: boolean }[],
  mirrored: boolean,
): boolean {
  const last = lines.filter((line) => !line.background).at(-1);
  return !!last && last.opposite !== mirrored;
}

export function WriterCredits({ names }: { names: string[] }) {
  if (!names.length) return null;
  return (
    <p className="writer-credits">
      <span className="credit-label">Written by</span>{" "}
      <span className="credit-names">{names.join(", ")}</span>
    </p>
  );
}

function creditsInView(container: HTMLElement, above: HTMLElement) {
  const credits = above.nextElementSibling as HTMLElement | null;
  const height = credits
    ? credits.offsetHeight + parseFloat(getComputedStyle(credits).marginTop)
    : 0;
  return (
    above.offsetTop + above.offsetHeight + height <=
    container.scrollTop + container.clientHeight + 2
  );
}

/** Seek Fade-in Compensation from Spicy Lyrics: a clicked lyric starts
 *  this far early, so a device's fade-in after a seek ends as it begins. */
const SEEK_FADE_LEAD_MS = 300;
const lyricSeekTarget = (ms: number) => Math.max(0, ms - SEEK_FADE_LEAD_MS);
/** Spicy Lyrics resumes following this long after the last scroll. */
const BROWSE_COOLDOWN_MS = 750;
export function LyricsDisplay({
  lyrics,
  positionMs,
  settings,
  onSeek,
  compact = false,
  writers = [],
  upNext,
}: {
  lyrics: Lyrics;
  positionMs: number;
  settings: Settings;
  onSeek: (ms: number) => void;
  compact?: boolean;
  writers?: string[];
  /** Sits beside the credits at the end of the lyrics. */
  upNext?: ReactNode;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [returnDirection, setReturnDirection] = useState<"up" | "down">("down");
  const footerMode = settings.lyrics_pinned_footer ?? "off";
  const writerCredits = (
    <WriterCredits
      names={lyrics.songwriters?.length ? lyrics.songwriters : writers}
    />
  );
  // As in Spicy Lyrics, browsing ends on its own once the user stops
  // scrolling with the current lyric still on screen; scrolled away from
  // it, browsing stays until they return or select a lyric.
  const glide = useRef<{ from: number; start: number }>(undefined);
  const browsedAt = useRef(0);
  const browse = () => {
    glide.current = undefined;
    browsedAt.current = performance.now();
    setFollowing(false);
  };
  const lines = useRef<(HTMLButtonElement | null)[]>([]);
  const seek = useRef(onSeek);
  const seekLead = settings.lyrics_seek_compensation !== false;
  useLayoutEffect(() => {
    seek.current = (ms) => onSeek(seekLead ? lyricSeekTarget(ms) : ms);
  }, [onSeek, seekLead]);
  // Clock frames must not replace each button's native click listener or ref.
  const lineActions = useMemo(
    () =>
      lyrics.lines.map((line, index) => ({
        ref: (element: HTMLButtonElement | null) => {
          lines.current[index] = element;
        },
        click: () => {
          if (lyrics.synced) {
            seek.current(line.words[0]?.start_ms ?? line.start_ms);
            setFollowing(true);
          }
        },
      })),
    [lyrics],
  );
  const spring = useRef<ScrollSpring>({ position: 0, velocity: 0, target: 0 });
  const heldEnd = useRef<{ top: number; gap: number } | null>(null);
  /** The credits are in view at the scroll's target, so they hold. */
  const holdEnd = useRef(false);
  // Where held credits rest, noted wherever the scroll settles (not only
  // at the very end: the current line can hold the scroll above it), so
  // the first frames of the dots opening are corrected too. A scroll event
  // notes it only when none is known, and a spot the scroll still sits on
  // is kept, or growth read before it is corrected would be taken as rest.
  const noteHeldRest = (container: HTMLElement, settled: boolean) => {
    const above = container.querySelector(":scope > .lyric-end-credits")
      ?.previousElementSibling as HTMLElement | null | undefined;
    // Re-checked as the scroll moves: pinned credits left behind by a
    // scroll back up were drawn over the lines below them.
    if (above) {
      const rest = heldEnd.current;
      const anchored = !!rest && Math.abs(container.scrollTop - rest.top) < 2;
      container.toggleAttribute(
        "data-hold-end",
        holdEnd.current && (anchored || creditsInView(container, above)),
      );
    }
    if (!above || !container.hasAttribute("data-hold-end")) {
      heldEnd.current = null;
      return;
    }
    const held = heldEnd.current;
    if (held && (!settled || Math.abs(container.scrollTop - held.top) < 0.5))
      return;
    const viewport = container.getBoundingClientRect();
    const scale = viewport.height / container.clientHeight || 1;
    heldEnd.current = {
      top: container.scrollTop,
      gap: (viewport.bottom - above.getBoundingClientRect().bottom) / scale,
    };
  };
  const waiting = useRef<HTMLDivElement>(null);
  const gap = lyrics.synced ? vocalGap(lyrics.lines, positionMs) : undefined;
  const gaps = useMemo(
    () => new Map(vocalGaps(lyrics.lines).map((item) => [item.after, item])),
    [lyrics],
  );
  const waitingDots = (item: VocalGap) => {
    const visible = gap?.start === item.start;
    return (
      <LyricCountdown
        key={item.start}
        ref={visible ? waiting : undefined}
        gap={item}
        // Song time only matters near the pause; held still elsewhere, a
        // countdown far off does not render again every frame.
        time={Math.min(
          item.end + COUNTDOWN_REACH_MS,
          Math.max(item.start - COUNTDOWN_REACH_MS, positionMs),
        )}
        reduceMotion={settings.reduce_motion}
        visible={visible}
      />
    );
  };
  // Early scroll follows the line about to be sung; highlighting still
  // follows the real song time.
  const scrollTime =
    positionMs +
    (settings.lyrics_early_scroll
      ? (settings.lyrics_early_scroll_ms ?? 200)
      : 0);
  const active = activeLines(lyrics.lines, scrollTime);
  const primary =
    active.find((index) => !lyrics.lines[index].background) ??
    lyrics.lines.reduce(
      (last, line, index) =>
        line.start_ms <= scrollTime && !line.background ? index : last,
      0,
    );
  useEffect(() => {
    setFollowing(true);
  }, [lyrics]);
  // A restart, Previous or seek moves song time far in one step. Lyrics then
  // slide straight there instead of springing through the whole song.
  const lastPosition = useRef(positionMs),
    jumped = useRef(false);
  const positionJumped = Math.abs(positionMs - lastPosition.current) > 1500;
  if (positionJumped) jumped.current = true;
  lastPosition.current = positionMs;
  const animator = useRef<LyricAnimator>(undefined);
  // New springs pick up the animator preset's curves and tuning.
  const tuning = JSON.stringify(settings.lyrics_animator ?? {});
  useLayoutEffect(() => {
    tuneMotion(JSON.parse(tuning));
    const instance = new LyricAnimator(
      lyrics,
      (index) => lines.current[index] ?? null,
      !!settings.reduce_motion,
      !!settings.lyrics_simple,
      scroll.current?.ownerDocument.defaultView ?? window,
    );
    animator.current = instance;
    return () => instance.dispose();
  }, [lyrics, settings.reduce_motion, settings.lyrics_simple, tuning]);
  useLayoutEffect(() => {
    if (!lyrics.synced) return;
    if (positionJumped) animator.current?.reset();
    animator.current?.update(positionMs);
  }, [positionMs, lyrics, settings.reduce_motion, settings.lyrics_simple, tuning]);
  // Romanization, translations or a word filter change only the words: the
  // view stays on the current line instead of sliding to where it rewraps.
  const timing = useMemo(
    () => lyrics.lines.map((line) => line.start_ms).join(","),
    [lyrics],
  );
  // The first placement, as the page opens or an effect switches, lands on
  // the current line at once rather than sliding up from the top.
  const placed = useRef(false);
  const wording = useRef({
    lyrics,
    timing,
    translations: settings.lyrics_translations,
  });
  useLayoutEffect(() => {
    const before = wording.current;
    let reworded =
      before.timing === timing &&
      (before.lyrics !== lyrics ||
        before.translations !== settings.lyrics_translations);
    wording.current = {
      lyrics,
      timing,
      translations: settings.lyrics_translations,
    };
    const container = scroll.current,
      line = gap ? waiting.current : lines.current[primary];
    if (!container || !line || !lyrics.synced) {
      spring.current.velocity = 0;
      return;
    }
    const view = container.ownerDocument.defaultView ?? window;
    let frame = 0,
      last = performance.now();
    spring.current.position = container.scrollTop;
    const tick = () => {
      const time = performance.now();
      frame = 0;
      if (!frameDue(last, time)) {
        frame = view.requestAnimationFrame(tick);
        return;
      }
      const motion = spring.current,
        slide = glide.current;
      if (slide) {
        const elapsed = time - slide.start;
        container.scrollTop = motion.position = glideScroll(
          slide.from,
          motion.target,
          elapsed,
        );
        motion.velocity = 0;
        last = time;
        if (elapsed < GLIDE_MS) frame = view.requestAnimationFrame(tick);
        else {
          glide.current = undefined;
          noteHeldRest(container, true);
        }
        return;
      }
      container.scrollTop = stepScroll(
        motion,
        Math.min(0.064, Math.max(0, (time - last) / 1000)),
      );
      last = time;
      if (
        Math.abs(motion.position - motion.target) > 0.2 ||
        Math.abs(motion.velocity) > 0.5
      )
        frame = view.requestAnimationFrame(tick);
      else {
        container.scrollTop = motion.target;
        noteHeldRest(container, true);
      }
    };
    const retarget = () => {
      const stacked = container
        .closest(".lyrics-page")
        ?.classList.contains("narrow");
      // Playback follows the line's centre, independent of artwork. Wide
      // lyrics still begin above centre and stop at the padded credits.
      // The Now playing card starts right under its header and keeps one
      // faded line above the current one, as Spicy Lyrics' card does.
      // Expanded over the whole panel, it reads like the lyrics page: the
      // song starts a third down and the current line stays centred.
      const card = compact && !container.closest(".lyric-preview.expanded");
      const focus = card
        ? Math.min(40, container.clientHeight * 0.14)
        : container.clientHeight / 2;
      const centred = !card;
      // Minimal lyrics in full screen begin lower, as in Spicy Lyrics.
      const opening =
        settings.lyrics_minimal && !compact && container.closest(".immersive")
          ? 0.4
          : 0.28;
      const leadTop = `${card ? 8 : compact || !stacked ? container.clientHeight * opening : Math.max(0, focus - (lines.current[0]?.offsetHeight ?? 0) / 2)}px`;
      if (container.style.getPropertyValue("--lead-top") !== leadTop)
        container.style.setProperty("--lead-top", leadTop);
      spring.current.target = Math.max(
        0,
        Math.min(
          container.scrollHeight - container.clientHeight,
          line.offsetTop + (centred ? line.offsetHeight / 2 : 0) - focus,
        ),
      );
      // Credits in view stay whole: when a pause's dots open near the end,
      // the lyrics move up rather than the credits being pushed off the
      // bottom. The current line still stays in view.
      const credits = container.querySelector<HTMLElement>(
        ":scope > .lyric-end-credits",
      );
      const end = container.scrollHeight - container.clientHeight;
      // Read from the row above: held credits are sticky, which moves
      // their own offsetTop.
      const above = credits?.previousElementSibling as HTMLElement | null;
      const holding =
        !!above &&
        above.offsetTop + above.offsetHeight <
          spring.current.target + container.clientHeight;
      // The card keeps its faded line above the current one even here;
      // aiming at the line's top edge slid it to the very top and back.
      if (holding)
        spring.current.target = Math.max(
          spring.current.target,
          Math.min(end, line.offsetTop - (card ? focus : 0)),
        );
      // The dots grow over half a second; a spring chasing them would let
      // the credits dip out of view first. Shifting in the same frame keeps
      // them still while the lyrics move up.
      // Measured from where the lyrics end, not the whole-pixel scroll
      // height, which lags the dots' fractional growth.
      const viewport = container.getBoundingClientRect();
      const scale = viewport.height / container.clientHeight || 1;
      const gap = () =>
        (viewport.bottom - above!.getBoundingClientRect().bottom) / scale;
      // The gap is kept from when the scroll rested, so rounding can't add
      // up while the dots keep growing.
      const held = heldEnd.current;
      const anchored =
        holding &&
        following &&
        !!held &&
        Math.abs(container.scrollTop - held.top) < 2;
      if (anchored) {
        const shift = held.gap - gap();
        if (shift > 0) {
          container.scrollTop += shift;
          spring.current.position = container.scrollTop;
          if (glide.current) glide.current.from += shift;
        }
      }
      // A pause opening above held credits only pushes the lyrics up; the
      // scroll stays where it rested rather than re-aiming at the dots.
      if (anchored && line === waiting.current)
        spring.current.target = container.scrollTop;
      heldEnd.current = !holding
        ? null
        : anchored
          ? { top: container.scrollTop, gap: held.gap }
          : held;
      // Pinned only once the credits really sit in view: pinning them while
      // the scroll is still on its way, or in a card too short to reach
      // the target, drew them over the lines still below.
      holdEnd.current = holding;
      container.toggleAttribute(
        "data-hold-end",
        holding && (anchored || creditsInView(container, above!)),
      );
      if (!following) {
        spring.current.velocity = 0;
        setReturnDirection(
          container.scrollTop > spring.current.target ? "up" : "down",
        );
        return;
      }
      if (reworded || !placed.current) {
        placed.current = true;
        reworded = false;
        view.cancelAnimationFrame(frame);
        frame = 0;
        glide.current = undefined;
        container.scrollTop = spring.current.position = spring.current.target;
        spring.current.velocity = 0;
        return;
      }
      // Smooth scrolling off: the browser's own smooth scroll, not the spring.
      const native = settings.lyrics_smooth_scroll === false;
      if (jumped.current && !settings.reduce_motion && !native)
        glide.current = {
          from: container.scrollTop,
          start: performance.now(),
        };
      if (settings.reduce_motion || native) {
        container.scrollTo({
          top: spring.current.target,
          behavior: native && !settings.reduce_motion ? "smooth" : "instant",
        });
        spring.current.position = spring.current.target;
        spring.current.velocity = 0;
      } else if (!frame) {
        last = performance.now();
        frame = view.requestAnimationFrame(tick);
      }
    };
    retarget();
    const observer = new ResizeObserver(retarget);
    observer.observe(container);
    observer.observe(line);
    container
      .querySelectorAll(".lyric-wait, :scope > .lyric-end-credits")
      .forEach((row) => observer.observe(row));
    const album = container
      .closest(".lyrics-page")
      ?.querySelector(".lyrics-album");
    if (album) observer.observe(album);
    return () => {
      view.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [
    primary,
    following,
    lyrics,
    settings.reduce_motion,
    settings.lyric_size,
    settings.romanized,
    settings.lyrics_translations,
    settings.lyrics_minimal,
    settings.lyrics_smooth_scroll,
    footerMode,
    gap?.start,
  ]);
  useLayoutEffect(() => {
    // Held until follow mode resumes, so a jump while browsing still glides.
    if (following) jumped.current = false;
  }, [positionMs, following]);
  useEffect(() => {
    if (following || !lyrics.synced) return;
    if (performance.now() - browsedAt.current < BROWSE_COOLDOWN_MS) return;
    const container = scroll.current,
      line = lines.current[primary];
    if (!container || !line) return;
    const view = container.getBoundingClientRect(),
      box = line.getBoundingClientRect();
    if (Math.min(box.bottom, view.bottom) - Math.max(box.top, view.top) >= 5)
      setFollowing(true);
  }, [positionMs, following, primary, lyrics.synced]);
  const highlighter = !!settings.lyrics_highlighter && lyrics.synced;
  if (lyrics.instrumental)
    return (
      <div className="lyrics-message">
        <Music2 />
        <h2>Instrumental</h2>
        <p>Enjoy the music</p>
        <LyricCredits
          lyrics={lyrics}
          discord={settings.lyrics_discord_usernames !== false}
        />
      </div>
    );
  return (
    <div
      className={`lyrics-display ${compact ? "compact" : ""} ${footerMode !== "off" ? "has-pinned-footer" : ""} ${!lyrics.synced ? "static-lyrics" : ""} ${settings.reduce_motion ? "reduce-motion" : ""} ${settings.lyrics_simple ? "simple-lyrics" : ""} ${settings.lyrics_right_align ? "lyrics-right" : ""} ${settings.lyrics_flip_duet ? "lyrics-flip-duet" : ""} ${settings.lyrics_wide_duet === false ? "" : "lyrics-wide-duet"} ${settings.lyrics_line_hover ? "lyrics-line-hover" : ""} ${lyrics.lines.some((line) => line.opposite) ? "has-duet" : ""} ${settings.lyrics_minimal && !compact ? "minimal" : ""} ${highlighter ? "highlighter" : ""} ${settings.lyrics_keep_overlaps !== false ? "keep-overlaps" : ""} ${lyrics.synced && lyrics.lines.length && positionMs >= Math.max(...lyrics.lines.map(vocalEnd)) ? "all-sung" : ""} ${settings.lyrics_credits_follow && endsOnRight(lyrics.lines, !!(settings.lyrics_flip_duet || settings.lyrics_right_align)) ? "credits-right" : ""}`}
      data-following={following}
      data-animator={presetOf(settings.lyrics_animator)}
      style={
        {
          ...(compact
            ? {}
            : {
                "--lyric-size": `${Math.round(settings.lyric_size * 1.6)}px`,
              }),
          ...(highlighter
            ? {
                "--highlighter-ink": markerColour(
                  settings.lyrics_highlighter_color,
                ),
              }
            : {}),
        } as CSSProperties
      }
    >
      <div
        className="lyric-scroll"
        data-at-end={atEnd}
        onScroll={(event) => {
          const node = event.currentTarget;
          // Only the Now playing card fades its top by scroll distance. The
          // value stops changing once the fade is whole, so scrolling does
          // not restyle the lyrics on every frame.
          if (compact) {
            const scrolled = `${Math.min(80, Math.round(node.scrollTop))}px`;
            if (node.style.getPropertyValue("--scrolled") !== scrolled)
              node.style.setProperty("--scrolled", scrolled);
          }
          setAtEnd(
            node.scrollTop + node.clientHeight >= node.scrollHeight - 24,
          );
          noteHeldRest(node, false);
          if (!following)
            setReturnDirection(
              node.scrollTop > spring.current.target ? "up" : "down",
            );
        }}
        ref={scroll}
        onWheel={browse}
        onTouchStart={browse}
        tabIndex={0}
        onKeyDown={(event) => {
          if (
            [
              "ArrowUp",
              "ArrowDown",
              "PageUp",
              "PageDown",
              "Home",
              "End",
            ].includes(event.key)
          )
            browse();
        }}
      >
        <div className="lyric-spacer" />
        {gaps.has(-1) && waitingDots(gaps.get(-1)!)}
        {lyrics.lines.map((line, index) => {
          const playing = active.includes(index);
          const distance = Math.abs(index - primary);
          return (
            <Fragment key={`${line.start_ms}-${index}`}>
              <LyricRow
                line={line}
                action={lineActions[index]}
                playing={playing}
                past={!playing && scrollTime >= vocalEnd(line)}
                blur={compact || playing ? 0 : lineBlur(distance)}
                synced={lyrics.synced}
                highlighter={highlighter}
                // A line keeps following the song until its last word ends,
                // even after the next line takes over, so the pen finishes
                // at the singing's pace; then it keeps all its ink. Lines
                // not being sung hold still, so they skip rendering.
                time={
                  !highlighter
                    ? 0
                    : playing ||
                        (positionMs >= line.start_ms &&
                          positionMs < vocalEnd(line))
                      ? positionMs
                      : positionMs >= line.start_ms
                        ? Infinity
                        : -Infinity
                }
                translation={settings.lyrics_translations}
              />
              {gaps.has(index) && waitingDots(gaps.get(index)!)}
            </Fragment>
          );
        })}
        {footerMode !== "full" && (
          <div className="lyric-end-credits">
            {writerCredits}
            {footerMode === "off" && (
              <div className={upNext ? "lyric-credits-row" : undefined}>
                <LyricCredits
                  lyrics={lyrics}
                  expanded
                  discord={settings.lyrics_discord_usernames !== false}
                />
                {upNext}
              </div>
            )}
          </div>
        )}
      </div>
      {footerMode !== "off" && (
        <div
          className="lyric-end-credits lyric-pinned-footer"
          role="region"
          aria-label="Pinned lyrics footer"
        >
          {footerMode === "full" && writerCredits}
          <div className={upNext ? "lyric-credits-row" : undefined}>
            <LyricCredits
              lyrics={lyrics}
              expanded
              discord={settings.lyrics_discord_usernames !== false}
            />
            {upNext}
          </div>
        </div>
      )}
      {!following &&
        lyrics.synced &&
        settings.lyrics_follow_button !== false && (
          <button
            type="button"
            className="follow-lyrics"
            title="Return to current lyric"
            aria-label="Return to current lyric"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setFollowing(true)}
          >
            {returnDirection === "up" ? (
              <ChevronUp size={28} strokeWidth={2.5} />
            ) : (
              <ChevronDown size={28} strokeWidth={2.5} />
            )}
          </button>
        )}
    </div>
  );
}

/** Static lyric markup. LyricAnimator moves the syllables and letters. */
/** How far either side of a pause its countdown follows song time. */
const COUNTDOWN_REACH_MS = 3000;

/** One lyric line. Memoised: while a song plays only the lines whose role,
 *  blur or ink changes render again, not every word of every line. */
const LyricRow = memo(function LyricRow({
  line,
  action,
  playing,
  past,
  blur,
  synced,
  highlighter,
  time,
  translation,
}: {
  line: Line;
  action: {
    ref: (element: HTMLButtonElement | null) => void;
    click: () => void;
  };
  playing: boolean;
  past: boolean;
  blur: number;
  synced: boolean;
  highlighter: boolean;
  time: number;
  translation?: boolean;
}) {
  return (
    <button
      ref={action.ref}
      className={`lyric-line ${playing ? "active" : ""} ${line.background ? "background-vocal" : ""} ${line.opposite ? "opposite" : ""} ${past ? "past" : ""}`}
      style={{ "--blur": `${blur}px` } as CSSProperties}
      onClick={action.click}
      disabled={!synced}
      // Clicking seeks without taking focus, so Space stays with play and
      // pause.
      onMouseDown={(event) => event.preventDefault()}
    >
      <span className="lyric-main">
        {highlighter ? (
          <HighlighterWords line={line} time={time} />
        ) : (
          <LyricWords line={line} />
        )}
      </span>
      {/* Lyrics can carry translations, such as Chinese under English; like
          Spicy Lyrics they stay hidden unless asked for. */}
      {line.reading && (
        // Sung like the line above it, with calmer motion.
        <span className="lyric-romanization sung">
          <LyricWords line={line.reading} />
        </span>
      )}
      {translation && line.translation && (
        <span className="lyric-translation">{line.translation}</span>
      )}
    </button>
  );
});

const LyricWords = memo(function LyricWords({ line }: { line: Line }) {
  const groups = useMemo(() => wordGroups(line.words), [line]);
  if (!line.words.length)
    return <span className="lyric-plain">{line.text}</span>;
  return (
    <>
      {groups.flatMap((group, index) => {
        // A long hyphenated run like "no-oh-oh-oh" wraps at its hyphens
        // instead of moving to a line of its own.
        const runs: (typeof group)[] = [[]];
        group.forEach((word, part) => {
          runs.at(-1)!.push(word);
          if (part < group.length - 1 && /[-‐]$/u.test(word.text))
            runs.push([]);
        });
        let offset = 0;
        return runs.map((run, piece) => {
          const at = offset;
          offset += run.length;
          return (
            <LyricWord
              key={`${index}-${piece}`}
              words={run}
              offset={at}
              total={group.length}
            />
          );
        });
      })}
    </>
  );
});

const SKELETON_WIDTHS = [71, 56, 87, 48, 76, 63, 90, 52, 69, 81, 59, 74];
/** Placeholder lines where the lyrics will land, while they are fetched. */
export function LyricsSkeleton() {
  return (
    <div className="lyrics-skeleton" role="status" aria-label="Loading lyrics">
      <div className="lyrics-skeleton-lines" aria-hidden="true">
        {SKELETON_WIDTHS.map((width, index) => (
          <span
            key={index}
            style={{ width: `${width}%`, "--line": index } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}
