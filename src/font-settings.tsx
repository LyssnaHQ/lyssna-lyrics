import { useId, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, Check } from "lucide-react";
import { useAnchoredPopover } from "./anchored-popover";
import { SettingRow } from "./lyssna/setting-row";
import { spotifyMix, type Settings } from "./settings";

type FontField = "ui_font" | "lyric_font";
const suggestedFonts = [spotifyMix, "Segoe UI", "Arial", "Georgia", "Verdana", "Trebuchet MS", "Consolas"];
const appFallback = '"Lyssna Metropolis", "Segoe UI Variable Text", "Segoe UI", Arial, sans-serif';
const lyricFallback = '"Lyssna Inter", "Segoe UI", sans-serif';

function fontChoice(value?: string) {
  const family = typeof value === "string" ? value.trim() : "";
  if (!family || family.length > 100 || /[\x00-\x1f\x7f]/.test(family) || /^(Lyssna|SpotiFlex)Font_/i.test(family)) return spotifyMix;
  if (/^spotify\s*mix(?:\s*ui)?$/i.test(family)) return spotifyMix;
  return family;
}

export function selectedFont(settings: Settings, field: FontField) {
  return settings.custom_fonts_enabled ? fontChoice(settings[field]) : undefined;
}

export function fontFamily(family: string) {
  return `"${family.replace(/["\\]/g, "\\$&")}"`;
}

function stack(family: string | undefined, fallback: string) {
  if (!family) return fallback;
  const chosen = family === spotifyMix ? 'var(--encore-body-font-stack, "SpotifyMixUI")' : fontFamily(family);
  return `${chosen}, ${fallback}`;
}

export function appFontStyles(settings: Settings): CSSProperties {
  const app = selectedFont(settings, "ui_font");
  const lyrics = selectedFont(settings, "lyric_font");
  return {
    fontFamily: stack(app, appFallback),
    "--lyric-font": stack(lyrics, lyricFallback),
    "--lyric-detail-font": lyrics ? stack(lyrics, lyricFallback) : undefined,
  } as CSSProperties;
}

export function copySpotifyFonts(page: Document) {
  const css: string[] = [];
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) {
      if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
      const family = (rule as CSSFontFaceRule).style.getPropertyValue("font-family").replace(/["']/g, "").trim();
      if (!/^(SpotifyMixUI(?:-\w+)?|DevanagariFallback)$/i.test(family)) continue;
      css.push(rule.cssText.replace(/url\((?:"([^"]+)"|'([^']+)'|([^\s)]+))\)/g, (_match, double, single, bare) =>
        `url(${JSON.stringify(new URL(double ?? single ?? bare, sheet.href ?? document.baseURI).href)})`));
    }
  }
  if (!css.length) return;
  const stylesheet = page.createElement("style");
  stylesheet.textContent = css.join("\n");
  page.head.append(stylesheet);
  const families = getComputedStyle(document.body).getPropertyValue("--encore-body-font-stack");
  if (families.trim()) page.documentElement.style.setProperty("--encore-body-font-stack", families);
}

export function FontSettings({ field, settings, change, view }: {
  field: FontField; settings: Settings; change(patch: Partial<Settings>): void; view: Window;
}) {
  const label = field === "lyric_font" ? "Lyrics font" : "App font";
  const value = fontChoice(settings[field]);
  const enabled = settings.custom_fonts_enabled;
  const id = useId();
  const control = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string>();
  const [active, setActive] = useState(-1);
  const filter = draft?.trim().toLowerCase() ?? "";
  const options = suggestedFonts.filter((family) => family.toLowerCase().includes(filter));
  const expanded = enabled && open && options.length > 0;
  useAnchoredPopover(view, expanded, control, list, true);

  function finish(family?: string) {
    if (family !== undefined && enabled && fontChoice(family) !== value) change({ [field]: fontChoice(family) });
    setDraft(undefined);
    setOpen(false);
    setActive(-1);
  }

  return <SettingRow label={label} help={field === "lyric_font"
    ? "Choose a font or type an installed family name."
    : "Used in Lyssna menus and controls. Type an installed family name to use it here."} keywords="font typeface spotify mix installed">
    <div className="lyssna-font-control" ref={control}>
      <input ref={input} className="settings-select" type="text" role="combobox" aria-label={label}
        aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? id : undefined}
        aria-activedescendant={expanded && active >= 0 ? `${id}-${active}` : undefined}
        value={draft ?? value} disabled={!enabled} placeholder={spotifyMix} autoComplete="off" spellCheck={false} maxLength={100}
        onFocus={(event) => event.currentTarget.select()} onBlur={() => finish(draft)}
        onChange={(event) => { setDraft(event.currentTarget.value); setActive(-1); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && (open || draft !== undefined)) {
            event.preventDefault();
            event.stopPropagation();
            finish();
          } else if (event.key === "Enter" && (open || draft !== undefined)) {
            event.preventDefault();
            finish(expanded ? options[active] ?? draft : draft);
          } else if (options.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            const next = event.key === "ArrowDown" ? (active + 1) % options.length
              : active <= 0 ? options.length - 1 : active - 1;
            setOpen(true);
            setActive(next);
            list.current?.children[next]?.scrollIntoView({ block: "nearest" });
          }
        }} />
      <button type="button" tabIndex={-1} disabled={!enabled} aria-label={`${expanded ? "Hide" : "Show"} ${label.toLowerCase()} suggestions`}
        onPointerDown={(event) => event.preventDefault()} onClick={() => { input.current?.focus(); setOpen(!open); setActive(-1); }}>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <ul className="lyssna-font-options" ref={list} id={id} popover="auto" role="listbox" aria-label={`${label} suggestions`}
        onToggle={(event) => { if (event.newState === "closed" && !list.current?.matches(":popover-open")) setOpen(false); }}>
        {options.map((family, index) => <li key={family} id={`${id}-${index}`} role="option" aria-selected={family === value}
          data-active={index === active || undefined} onPointerDown={(event) => event.preventDefault()} onClick={() => finish(family)}>
          <span>{family}</span>{family === value && <Check size={14} aria-hidden="true" />}
        </li>)}
      </ul>
    </div>
  </SettingRow>;
}
