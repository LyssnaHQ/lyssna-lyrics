import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { ArrowUpDown, Ban, CaseLower, CaseSensitive, CaseUpper, ChartNoAxesColumn, Check, ChevronDown, History, Shuffle, SlidersHorizontal, Sparkles, Type } from "lucide-react";
import { useAnchoredPopover } from "./anchored-popover";
import { FontControl } from "./font-settings";
import type { Track } from "./host";
import { lyricSources, setSongLyricSource, songLyricSource, sourceIds } from "./lyric-sources";
import { ANIMATOR_PRESETS, ANIMATOR_PRESET_LABELS, choosePreset, presetOf } from "./lyssna/animator-tuning";
import { WORD_FILTER_OPTIONS } from "./lyssna/word-filter";
import type { Settings } from "./settings";

function GravityIcon() {
  return <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <g className="gravity-orbit">
      <ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(-36 12 12)" />
      <circle cx="19.7" cy="6.4" r="2.1" fill="currentColor" stroke="none" />
    </g>
  </svg>;
}

function HighlighterIcon() {
  return <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <g className="marker-pen">
      <path d="m8 13 8.7-8.7a1.8 1.8 0 0 1 2.6 0l.4.4a1.8 1.8 0 0 1 0 2.6L11 16l-3-3Z" />
      <path d="m8 13-2 2 3 3 2-2m-5-1-2 3 2 1 3-1" />
    </g>
    <path className="marker-stroke" d="M4 21h15" pathLength={1} />
  </svg>;
}

function AnimatorIcon() {
  return <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
    strokeLinecap="round" aria-hidden="true">
    <path d="M3 5h18M3 12h18M3 19h18" />
    <path className="preset-knob" d="M14 3v4" />
    <path className="preset-knob" d="M8 10v4" />
    <path className="preset-knob" d="M16 17v4" />
  </svg>;
}

export const quickEffects = [
  { id: "space_gravity", kind: "toggle", label: "Space Gravity", Icon: GravityIcon },
  { id: "lyrics_highlighter", kind: "toggle", label: "Highlighter", Icon: HighlighterIcon },
  { id: "lyrics_visualiser", kind: "toggle", label: "Visualiser", Icon: () => <ChartNoAxesColumn size={18} strokeWidth={1.8} aria-hidden="true" /> },
  { id: "animator", kind: "picker", label: "Animator Presets", Icon: AnimatorIcon },
  { id: "word-filter", kind: "picker", label: "Unique word filters", Icon: () => <CaseSensitive size={18} strokeWidth={1.8} aria-hidden="true" /> },
  { id: "lyric-font", kind: "picker", label: "Lyrics font", Icon: () => <Type size={18} strokeWidth={1.8} aria-hidden="true" /> },
] as const;

export type QuickEffectChoice = Extract<(typeof quickEffects)[number], { kind: "picker" }>;

const choiceIcons = {
  Lyssna: Sparkles, Legacy: History, Bouncy: ArrowUpDown, Custom: SlidersHorizontal,
  off: Ban, gibberish: Shuffle, lower: CaseLower, upper: CaseUpper,
};

function moveChoiceFocus(event: KeyboardEvent<HTMLDivElement>, preventScroll = true) {
  const { key, currentTarget, target } = event;
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(key)) return;
  const buttons = Array.from(currentTarget.querySelectorAll("button"));
  const index = buttons.findIndex((button) => button === target);
  if (index < 0) return;
  event.preventDefault();
  event.stopPropagation();
  const next = key === "Home" ? 0 : key === "End" ? buttons.length - 1
    : (index + (key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
  buttons[next]?.focus({ preventScroll });
}

export function SongSourcePicker({ id, track, trigger, close, onError, view }: {
  id: string; track: Track; trigger: RefObject<HTMLButtonElement | null>; close: () => void; onError: () => void; view: Window;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const sources = sourceIds.filter(source => !track.local || (source !== "spotify" && source !== "spicy"));
  const preferred = songLyricSource(track);
  const selected = preferred && sources.includes(preferred) ? preferred : undefined;
  useAnchoredPopover(view, true, trigger, panel);
  useLayoutEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
  }, []);

  return <div className="lyssna-quick-popover lyssna-quick-source-list" id={id} ref={panel} popover="auto"
    role="group" aria-label="Lyrics source for this song" onKeyDown={(event) => moveChoiceFocus(event, false)}
    onToggle={(event) => { if (event.newState === "closed" && !panel.current?.matches(":popover-open")) close(); }}>
    {[undefined, ...sources].map(source => <button key={source ?? "default"} className="lyssna-quick-choice" type="button"
      aria-pressed={source === selected} onClick={() => {
        try { setSongLyricSource(track, source); }
        catch { onError(); return; }
        close();
      }}>
      {source ? lyricSources[source].name : "Your source order"}
      {source === selected && <Check size={14} aria-hidden="true" />}
    </button>)}
  </div>;
}

function VerticalFontPicker({ settings, change, view }: {
  settings: Settings; change: (patch: Partial<Settings>) => void; view: Window;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useAnchoredPopover(view, open, trigger, panel);
  return <>
    <button className="lyssna-quick-choice" type="button" ref={trigger} title="Choose lyrics font"
      aria-label="Choose lyrics font" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <ChevronDown size={16} aria-hidden="true" />
    </button>
    <div className="lyssna-quick-popover" id={id} ref={panel} popover="auto"
      onToggle={(event) => { if (event.newState === "closed" && !panel.current?.matches(":popover-open")) setOpen(false); }}>
      <FontControl field="lyric_font" settings={settings} change={change} view={view} />
    </div>
  </>;
}

export function QuickEffectPicker({ effect, settings, change, close, view, vertical }: {
  effect: QuickEffectChoice;
  settings: Settings;
  change: (patch: Partial<Settings>) => void;
  close: () => void;
  view: Window;
  vertical: boolean;
}) {
  const options = useRef<HTMLDivElement>(null);
  const choices = effect.id === "animator"
    ? ANIMATOR_PRESETS.map((value) => ({
        value,
        label: ANIMATOR_PRESET_LABELS[value],
        selected: value === presetOf(settings.lyrics_animator),
        apply: () => change({ lyrics_animator: choosePreset(settings.lyrics_animator, value) }),
      }))
    : effect.id === "word-filter" ? WORD_FILTER_OPTIONS.map(([value, label]) => ({
        value,
        label,
        selected: value === settings.lyrics_word_filter,
        apply: () => change({ lyrics_word_filter: value }),
      })) : [];

  useLayoutEffect(() => {
    const active = options.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    const first = options.current?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)');
    const target = active ?? first;
    if (!target) return;
    target.focus({ preventScroll: true });
    const expansion = target.closest(".lyssna-quick-expansion");
    const reveal = () => {
      if (target.matches(":focus")) target.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    const animation = expansion?.getAnimations()[0];
    if (animation) void animation.finished.then(reveal, () => {});
    else reveal();
  }, [effect, vertical]);

  return <div className="lyssna-quick-picker">
    {effect.id === "lyric-font" ? <div className="lyssna-quick-font" ref={options}>
      {vertical ? <VerticalFontPicker settings={settings} change={change} view={view} />
        : <FontControl field="lyric_font" settings={settings} change={change} view={view} />}
    </div> : <div className="lyssna-quick-choices" role="group" aria-label={effect.label} ref={options} onKeyDown={moveChoiceFocus}>
      {choices.map(({ value, label, selected, apply }) => {
        const Icon = choiceIcons[value];
        return <button className="lyssna-quick-choice" type="button" key={value} title={vertical ? label : undefined}
          aria-label={label} aria-pressed={selected} onClick={() => { apply(); close(); }}>
          {vertical ? <Icon size={16} aria-hidden="true" /> : label}
        </button>;
      })}
    </div>}
  </div>;
}
