import { memo } from "react";
import { isEmphasis, type AnimatedWord } from "./lyric-motion";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Shared static text; LyricAnimator drives its syllables and held letters. */
export const LyricWord = memo(function LyricWord({
  words,
  offset = 0,
  total = words.length,
  appleTiming,
}: {
  words: AnimatedWord[];
  /** Where these syllables sit in a word split over several boxes. */
  offset?: number;
  total?: number;
  appleTiming?: { start: number; end: number; ripple: boolean };
}) {
  const whitespace = words[0]?.text.match(/^\s+/u)?.[0] ?? "";
  const trailing = /\s$/u.test(words.at(-1)?.text ?? "");
  return (
    <span className="lyric-word-group">
      {whitespace}
      <span className="lyric-word"
        data-word-start={appleTiming?.ripple ? appleTiming.start : undefined}
        data-word-end={appleTiming?.ripple ? appleTiming.end : undefined}>
        {words.map((word, part) => {
          const content =
            part === 0 ? word.text.slice(whitespace.length) : word.text;
          const text = part === words.length - 1 ? content.trimEnd() : content;
          const letters = appleTiming?.ripple
            ? Array.from(graphemes.segment(text), ({ segment }) => segment)
            : !appleTiming && isEmphasis(word, text) ? Array.from(text) : [];
          // Split syllables scale away from their joints so no seam opens.
          const at = offset + part;
          const joined =
            total === 1
              ? ""
              : at === 0
                ? "joined-start"
                : at === total - 1
                  ? "joined-end"
                  : "joined-middle";
          return (
            <span
              key={part}
              className={`lyric-syllable ${letters.length ? "emphasis" : ""} ${joined}`}
              data-start={word.start_ms}
              data-end={word.end_ms}
              data-letter-offset={word.letterOffset}
              data-letter-count={word.letterCount}
            >
              {letters.length ? (
                letters.map((letter, index) => (
                  <span key={index} className="lyric-letter">
                    <span className="lyric-paint">{letter}</span>
                  </span>
                ))
              ) : (
                <span className="lyric-paint">{text}</span>
              )}
            </span>
          );
        })}
      </span>
      {trailing ? " " : null}
    </span>
  );
});
