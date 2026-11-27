import { useLayoutEffect, useRef, type MouseEvent } from "react";
import { wordGroups } from "../lyssna/lyric-motion";
import type { Lyrics } from "../lyssna/types";

export type ReviewQuote = { text: string; startMs?: number };
export type ReviewQuoteTarget = {
  x: number;
  y: number;
  line: ReviewQuote;
  word?: ReviewQuote;
};

export function reviewQuoteTarget(event: MouseEvent<HTMLElement>, lyrics: Lyrics): ReviewQuoteTarget | undefined {
  if (!(event.target instanceof Element)) return;
  const row = event.target.closest<HTMLElement>(".lyric-line[data-review-line], .gravity-line[data-line]");
  if (!row) return;
  const lyric = lyrics.lines[Number(row.dataset.reviewLine ?? row.dataset.line)];
  if (!lyric?.text.trim()) return;
  const line = { text: lyric.text, startMs: lyrics.synced ? lyric.start_ms : undefined };
  const wordElement = event.target.closest(".lyric-main :is(.lyric-word-group, .highlighter-word, .review-plain-word), .gravity-word");
  const wordText = wordElement?.textContent?.trim();
  const firstSyllable = wordElement?.querySelector<HTMLElement>(".lyric-syllable[data-start]");
  const start = Number(firstSyllable?.dataset.start);
  const firstText = firstSyllable?.textContent?.trim();
  const group = Number.isFinite(start) && wordGroups(lyric.words).find(parts =>
    parts.some(part => part.start_ms === start && part.text.trim() === firstText));
  const word = wordText ? {
    text: group ? group.map(part => part.text).join("").trim() : wordText,
    startMs: group ? group[0].start_ms : Number.isFinite(start) && lyric.words.length ? start : line.startMs,
  } : undefined;
  if (event.clientX || event.clientY) return { x: event.clientX, y: event.clientY, line, word };
  const { left, bottom } = (wordElement ?? row).getBoundingClientRect();
  return { x: left, y: bottom, line, word };
}

export function ReviewQuoteMenu({ target, view, close, onQuote }: {
  target: ReviewQuoteTarget;
  view: Window;
  close(): void;
  onQuote(quote: ReviewQuote): void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    if (!element.matches(":popover-open")) element.showPopover();
    element.style.left = `${Math.max(8, Math.min(target.x, view.innerWidth - element.offsetWidth - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(target.y, view.innerHeight - element.offsetHeight - 8))}px`;
    element.querySelector("button")?.focus({ preventScroll: true });
  }, [target, view]);
  const choose = (quote: ReviewQuote) => {
    menu.current?.hidePopover();
    close();
    onQuote(quote);
  };
  return (
    <div ref={menu} className="lyssna-quick-popover lyssna-quick-source-list lyssna-review-quote-menu"
      popover="auto" role="group" aria-label="Review feedback"
      onToggle={(event) => {
        if (event.newState === "closed" && !menu.current?.matches(":popover-open")) close();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        menu.current?.hidePopover();
      }}>
      <button type="button" className="lyssna-quick-choice" onClick={() => choose(target.line)}>Comment on line…</button>
      <button type="button" className="lyssna-quick-choice" disabled={!target.word}
        onClick={() => { if (target.word) choose(target.word); }}>Comment on word…</button>
    </div>
  );
}
