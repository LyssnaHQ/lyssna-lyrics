import { useCreatorEnvironment } from "./environment";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Info } from "lucide-react";
import { type LearnedSplits, learnFrom, suggestSplit } from "./ttml-syllables";
import { type GeniusChanges, romajiSyllables } from "./ttml-creator-model";

export interface MenuAction {
  label: string;
  run: () => void;
  disabled?: boolean;
  checked?: boolean;
}

export function WordMenu({
  x,
  y,
  groups,
  label = "Word actions",
  onClose,
}: {
  x: number;
  y: number;
  groups: MenuAction[][];
  label?: string;
  onClose: () => void;
}) {
  const { view: window } = useCreatorEnvironment();
  const element = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const box = element.current?.getBoundingClientRect();
    if (!box) return;
    setPlace({
      left: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)),
    });
  }, [window, x, y]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, window]);
  return (
    <>
      <div
        className="popover-dismiss"
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        ref={element}
        className="song-menu popover ttml-menu"
        role="menu"
        aria-label={label}
        style={place}
      >
        {groups.map((group, index) => (
          <div key={index} className="ttml-menu-group">
            {group.map((action) => (
              <button
                key={action.label}
                role="menuitem"
                disabled={action.disabled}
                onClick={() => {
                  onClose();
                  action.run();
                }}
              >
                {action.label}
                {action.checked && <Check size={14} className="menu-chevron" />}
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

const SPLIT_KEY = "lyssna.ttml-split-options";
const REPLACE_KEY = "lyssna.ttml-replace-options";

function loadChoices<K extends string>(
  key: string,
  defaults: Record<K, boolean>,
): Record<K, boolean> {
  const next = { ...defaults };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (saved && typeof saved === "object")
      for (const name of Object.keys(defaults) as K[]) {
        const value = (saved as Record<string, unknown>)[name];
        if (typeof value === "boolean") next[name] = value;
      }
  } catch {
    // Unreadable choices fall back to the defaults.
  }
  return next;
}

function saveChoices(key: string, choices: Record<string, boolean>) {
  try {
    localStorage.setItem(key, JSON.stringify(choices));
  } catch {
    // The choice still applies this time.
  }
}

export interface SplitChoice {
  offsets: number[];
  applyAll: boolean;
  ignoreCase: boolean;
  learned?: { key: string; offsets: number[] };
}

export interface ReplaceChoice {
  value: string;
  replaceAll: boolean;
  matchCase: boolean;
}

export function ReplaceDialog({
  word,
  onConfirm,
  onClose,
}: {
  word: string;
  onConfirm: (choice: ReplaceChoice) => void;
  onClose: () => void;
}) {
  const { view: window } = useCreatorEnvironment();
  const [value, setValue] = useState(word);
  const [saved] = useState(() =>
    loadChoices(REPLACE_KEY, { replaceAll: false, matchCase: false }),
  );
  const [replaceAll, setReplaceAll] = useState(saved.replaceAll);
  const [matchCase, setMatchCase] = useState(saved.matchCase);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => input.current?.select(), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const confirm = () => {
    saveChoices(REPLACE_KEY, { replaceAll, matchCase });
    onConfirm({ value, replaceAll, matchCase });
  };

  return (
    <div className="ttml-dialog-backdrop" onClick={onClose}>
      <form
        className="ttml-dialog"
        role="dialog"
        aria-label="Replace word"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          confirm();
        }}
      >
        <h3>Replace word</h3>
        <label className="ttml-field">
          New word:
          <input
            ref={input}
            value={value}
            spellCheck={false}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <label className="ttml-check">
          <input
            type="checkbox"
            checked={replaceAll}
            onChange={(event) => setReplaceAll(event.target.checked)}
          />
          Replace all identical words
        </label>
        <label className={`ttml-check${replaceAll ? "" : " off"}`}>
          <input
            type="checkbox"
            checked={matchCase}
            disabled={!replaceAll}
            onChange={(event) => setMatchCase(event.target.checked)}
          />
          Match case
        </label>
        <div className="ttml-dialog-row end">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Confirm
          </button>
        </div>
      </form>
    </div>
  );
}

export function SplitDialog({
  word,
  learned,
  onConfirm,
  onClose,
}: {
  word: string;
  learned: LearnedSplits;
  onConfirm: (choice: SplitChoice) => void;
  onClose: () => void;
}) {
  const { view: window } = useCreatorEnvironment();
  const chars = Array.from(word);
  const [suggestion] = useState(() => suggestSplit(word, learned));
  const [offsets, setOffsets] = useState<Set<number>>(
    () => new Set(suggestion),
  );
  const [options, setOptions] = useState(() =>
    loadChoices(SPLIT_KEY, {
      applyAll: false,
      remember: true,
      ignoreCase: true,
    }),
  );
  const suggested =
    offsets.size === suggestion.length &&
    suggestion.every((at) => offsets.has(at));
  const update = (patch: Partial<typeof options>) =>
    setOptions((current) => ({ ...current, ...patch }));
  const toggle = (at: number) =>
    setOffsets((current) => {
      const next = new Set(current);
      if (!next.delete(at)) next.add(at);
      return next;
    });
  const confirm = () => {
    const list = [...offsets].sort((a, b) => a - b);
    saveChoices(SPLIT_KEY, options);
    onConfirm({
      offsets: list,
      applyAll: options.applyAll,
      ignoreCase: options.ignoreCase,
      learned: options.remember ? learnFrom(word, list) : undefined,
    });
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="ttml-dialog-backdrop" onClick={onClose}>
      <div
        className="ttml-dialog"
        role="dialog"
        aria-label="Split word"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>Split word</h3>
        <p className="ttml-dialog-note">
          <Info size={16} />
          After splitting, the new syllables evenly divide the original word's
          start and end time.
        </p>
        <div className="ttml-splitter" aria-label="Split points">
          {chars.map((char, index) => (
            <span key={index} className="ttml-split-char">
              {index > 0 && (
                <button
                  className={`ttml-split-gap${offsets.has(index) ? " on" : ""}`}
                  aria-label={`Split before letter ${index + 1}`}
                  aria-pressed={offsets.has(index)}
                  onClick={() => toggle(index)}
                />
              )}
              {char}
            </span>
          ))}
        </div>
        <div className="ttml-dialog-row end">
          <button
            disabled={!suggestion.length || suggested}
            onClick={() => setOffsets(new Set(suggestion))}
            title={
              suggestion.length
                ? "Fill in the suggested syllable splits"
                : "No syllable split found for this word"
            }
          >
            Syllable split
          </button>
        </div>
        <label className="ttml-check">
          <input
            type="checkbox"
            checked={options.applyAll}
            onChange={(event) => update({ applyAll: event.target.checked })}
          />
          Apply this split to all identical words
        </label>
        <label className="ttml-check">
          <input
            type="checkbox"
            checked={options.remember}
            onChange={(event) => update({ remember: event.target.checked })}
          />
          Remember this split
        </label>
        <label className={`ttml-check${options.applyAll ? "" : " off"}`}>
          <input
            type="checkbox"
            checked={options.ignoreCase}
            disabled={!options.applyAll}
            onChange={(event) => update({ ignoreCase: event.target.checked })}
          />
          Ignore case
        </label>
        <div className="ttml-dialog-row end">
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={!offsets.size}
            onClick={confirm}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

/** Splits a word's reading into pieces that are timed one by one. */
export function ReadingSplitDialog({
  word,
  reading,
  matches = 0,
  onConfirm,
  onClose,
}: {
  word: string;
  reading: string;
  /** Other words with the same reading. */
  matches?: number;
  onConfirm: (reading: string, everywhere: boolean) => void;
  onClose: () => void;
}) {
  const [everywhere, setEverywhere] = useState(true);
  const chars = Array.from(reading.replace(/\|/g, ""));
  const [offsets, setOffsets] = useState<Set<number>>(() => {
    const given = new Set<number>();
    let at = 0;
    for (const char of reading) {
      if (char === "|") given.add(at);
      else at++;
    }
    return given;
  });
  const suggestion = romajiSyllables(chars.join(""));
  const toggle = (at: number) =>
    setOffsets((current) => {
      const next = new Set(current);
      if (!next.delete(at)) next.add(at);
      return next;
    });
  const confirm = () =>
    onConfirm(
      chars.map((char, index) => (offsets.has(index) ? `|${char}` : char)).join(""),
      matches > 0 && everywhere,
    );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="ttml-dialog-backdrop" onClick={onClose}>
      <div
        className="ttml-dialog"
        role="dialog"
        aria-label="Split reading"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>Split reading of {word}</h3>
        <p className="ttml-dialog-note">
          <Info size={16} />
          Each piece is timed on its own while syncing; the word keeps one
          start and end. Untimed pieces share the word's time evenly.
        </p>
        <div className="ttml-splitter" aria-label="Split points">
          {chars.map((char, index) => (
            <span key={index} className="ttml-split-char">
              {index > 0 && (
                <button
                  className={`ttml-split-gap${offsets.has(index) ? " on" : ""}`}
                  aria-label={`Split before letter ${index + 1}`}
                  aria-pressed={offsets.has(index)}
                  onClick={() => toggle(index)}
                />
              )}
              {char}
            </span>
          ))}
        </div>
        <div className="ttml-dialog-row end">
          <button
            disabled={!suggestion.length}
            onClick={() => setOffsets(new Set(suggestion))}
            title="Split where each syllable starts"
          >
            Syllable split
          </button>
          <button
            disabled={!offsets.size}
            onClick={() => setOffsets(new Set())}
          >
            Join all
          </button>
        </div>
        {matches > 0 && (
          <label className="ttml-check">
            <input
              type="checkbox"
              checked={everywhere}
              onChange={(event) => setEverywhere(event.target.checked)}
            />
            Split the {matches} other {matches === 1 ? "word" : "words"} read "
            {chars.join("")}" the same way
          </label>
        )}
        <div className="ttml-dialog-row end">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={confirm}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * What Sections from Genius changed, beside the draft so each change can
 * be looked at before keeping it.
 */
export function GeniusReview({
  changes,
  onGo,
  onKeep,
  onUndo,
  canUndo = true,
  onMakeLeads,
  onAddMissing,
  onFix,
  onIgnore,
}: {
  changes: GeniusChanges;
  onGo: (line: number) => void;
  onKeep: () => void;
  onUndo: () => void;
  /** Off once the draft was edited by hand, which Undo would discard. */
  canUndo?: boolean;
  /** Makes these lines background vocals, or lead lines. */
  onMakeLeads: (lines: number[], background: boolean) => void;
  onAddMissing: () => void;
  /** Puts in characters a line lacks against Genius. */
  onFix: (line: number, genius: string) => void;
  /** Stops listing a difference, where Genius has it wrong. */
  onIgnore: (each: GeniusChanges["differs"][number]) => void;
}) {
  const go = (line: number, label: string, key: string | number) => (
    <button
      key={key}
      className="ttml-review-chip"
      title={`Go to line ${line + 1}`}
      onClick={() => onGo(line)}
    >
      {label}
    </button>
  );
  const plural = (count: number, one: string, many: string) =>
    `${count} ${count === 1 ? one : many}`;
  const [showEarlier, setShowEarlier] = useState(false);
  return (
    <div className="ttml-dialog ttml-review" role="dialog" aria-label="Changes from Genius">
      <h3>Changes from Genius</h3>
      <section>
        <h4>
          {changes.sections.length
            ? plural(changes.sections.length, "section", "sections")
            : "No new sections"}
        </h4>
        <div className="ttml-review-chips">
          {changes.sections.map((each, index) =>
            go(each.line, `${each.line + 1} · ${each.part}`, index),
          )}
        </div>
      </section>
      {changes.backgrounds.length > 0 && (
        <section>
          <h4>
            Moved to background vocals ({changes.backgrounds.length})
          </h4>
          <div className="ttml-review-chips">
            {changes.backgrounds.map((each, index) =>
              go(each.line, `${each.line + 1} · ${each.text}`, index),
            )}
          </div>
        </section>
      )}
      {changes.singers.map((group) => (
        <section key={group.voice}>
          <h4>
            Sung by {group.voice} ({plural(group.lines.length, "line", "lines")})
          </h4>
          <div className="ttml-review-chips">
            {group.lines.map((line) => go(line, `${line + 1}`, line))}
          </div>
        </section>
      ))}
      {changes.leads.length > 0 && (
        <section>
          <h4>Background lines Genius sings as main lines</h4>
          <div className="ttml-review-chips">
            {changes.leads.map((each) =>
              go(each.line, `${each.line + 1} · ${each.text}`, each.line),
            )}
          </div>
          <button
            className="ttml-review-action"
            onClick={() =>
              onMakeLeads(
                changes.leads.map((each) => each.line),
                false,
              )
            }
          >
            Make {changes.leads.length === 1 ? "it a main line" : "them main lines"}
          </button>
        </section>
      )}
      {changes.echoes.length > 0 && (
        <section>
          <h4>Main lines Genius has in brackets</h4>
          <div className="ttml-review-chips">
            {changes.echoes.map((each) =>
              go(each.line, `${each.line + 1} · ${each.text}`, each.line),
            )}
          </div>
          <button
            className="ttml-review-action"
            onClick={() =>
              onMakeLeads(
                changes.echoes.map((each) => each.line),
                true,
              )
            }
          >
            Make {changes.echoes.length === 1 ? "it a background vocal" : "them background vocals"}
          </button>
        </section>
      )}
      {changes.missing.length > 0 && (
        <section>
          <h4>On Genius but missing from your draft</h4>
          <div className="ttml-review-chips">
            {changes.missing.map((each, index) =>
              go(
                Math.max(each.after, 0),
                `${each.after + 1} · ${each.background ? `(${each.text})` : each.text}`,
                index,
              ),
            )}
          </div>
          <button className="ttml-review-action" onClick={onAddMissing}>
            Add {changes.missing.length === 1 ? "it" : "them"}, untimed
          </button>
        </section>
      )}
      {changes.differs.length > 0 && (
        <section>
          <h4>Differs from Genius</h4>
          <div className="ttml-review-chips">
            {changes.differs.map((each) => (
              <span key={each.line} className="ttml-review-pair">
                {go(each.line, `${each.line + 1} · Genius: ${each.genius}`, "go")}
                {each.fixable && (
                  <button
                    className="ttml-review-chip primary"
                    title="Put in what this line lacks; timings stay"
                    onClick={() => onFix(each.line, each.genius)}
                  >
                    Fix
                  </button>
                )}
                <button
                  className="ttml-review-chip"
                  title="Genius has it wrong; stop pointing this out"
                  onClick={() => onIgnore(each)}
                >
                  Ignore
                </button>
              </span>
            ))}
          </div>
        </section>
      )}
      {changes.commas.length > 0 && (
        <section>
          <h4>Removed a comma left at the end of the line</h4>
          <div className="ttml-review-chips">
            {changes.commas.map((line) => go(line, `${line + 1}`, line))}
          </div>
        </section>
      )}
      {changes.mixed.length > 0 && (
        <section>
          <h4>Words sung by another voice</h4>
          <div className="ttml-review-chips">
            {changes.mixed.map((line) => go(line, `${line + 1}`, line))}
          </div>
        </section>
      )}
      {changes.earlier.length > 0 && (
        <section>
          <button
            className="ttml-review-action"
            aria-expanded={showEarlier}
            onClick={() => setShowEarlier(!showEarlier)}
          >
            {showEarlier ? "Hide" : "Show"} what was already there (
            {changes.earlier.length})
          </button>
          {showEarlier && (
            <div className="ttml-review-chips">
              {changes.earlier.map((each, index) =>
                go(each.line, `${each.line + 1} · ${each.label}`, index),
              )}
            </div>
          )}
        </section>
      )}
      <div className="ttml-dialog-row end">
        {canUndo && (
          <button onClick={onUndo} title="Put the draft back as it was">
            Undo
          </button>
        )}
        <button className="primary" onClick={onKeep}>
          Keep
        </button>
      </div>
    </div>
  );
}
