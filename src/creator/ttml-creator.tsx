import {
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileInput,
  History,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Send,
  Settings,
  Tags,
  Trash2,
  Type,
  Upload,
  Languages,
  Undo2,
  Wand2,
  Globe,
  X,
} from "lucide-react";
import { IS_MAC, MODIFIER, useCreatorClock, useCreatorEnvironment, useCreatorTick } from "./environment";
import { useEnhancedPerformance } from "../enhancements/config";
import type { CreatorState } from "./types";
import type { Lyrics, PlayerRequest, Track } from "./types";
import { lyricsChanged, parseLocalTtml } from "../local-lyrics";
import { revalidateLyssnaSong } from "../lyssna-provider";
import { ReviewPanel, type ReviewOpen, type ReviewSelection } from "./review-panel";
import {
  forgetWorking,
  markWorking,
  setShowsPreview,
  showLive,
  showsPreview,
} from "./ttml-working";
import { TOUR_KEY, TtmlTour } from "./ttml-tour";
import {
  type CreatorLine,
  type Cursor,
  type MetaEntry,
  type SongMeta,
  AUTHOR_KEYS,
  defaultMetadata,
  withSongwriters,
  applySections,
  addMissing,
  bracketsToBackground,
  fixFromGenius,
  geniusChanges,
  type GeniusChanges,
  breakLine,
  clampCursor,
  clearAll,
  toLyrics,
  clearTiming,
  duplicateLine,
  editUnit,
  appendWords,
  fileName,
  formatTime,
  fromLyrics,
  geniusBackgrounds,
  insertBlankLine,
  joinHyphenated,
  cursorAt,
  keepTimings,
  lineSpan,
  singingAt,
  markEnd,
  markNext,
  markStart,
  moveLine,
  moveWord,
  moveWords,
  deletePicked,
  applyRomanized,
  nextCursor,
  romanizeRequest,
  readingsFrom,
  romanParts,
  romanPieces,
  sameReadings,
  splitReadings,
  timingCursor,
  setUnitRoman,
  hasWordRoman,
  parseText,
  previousCursor,
  problems,
  progress,
  removeLine,
  setLineText,
  splitMatching,
  replaceMatching,
  splitUnit,
  timed,
  toText,
  toTtml,
  toggleJoin,
  toggleLine,
  wordBounds,
  moveSpace,
  setLineFlag,
  shiftLines,
  clearLines,
  removeLines,
  canSeed,
  lineVoice,
  sectionStart,
  sectionVoices,
  setLineVoice,
  setSection,
  setSectionSinger,
  setUnitVoice,
  unitVoice,
  unknownSections,
} from "./ttml-creator-model";
import { romanizeLyrics } from "../lyssna/romanization";
import { MetadataDialog } from "./ttml-metadata";
import { CreatorPlay, CreatorSpectrogramToggle, CreatorSpeed, TtmlBar } from "./ttml-bar";
import type { CreatorPlaybarSlots } from "./playbar";
import { TtmlSpectrogram } from "./ttml-spectrogram";
import { createPortal } from "../host-dom";
import {
  type ExportFormat,
  type WordFormat,
  EXPORT_FORMATS,
  WORD_FORMATS,
  exportLyrics,
  formatOf,
  parseWordFormat,
} from "./ttml-formats";

const FORMAT_NAMES: Record<ExportFormat | "ttml", string> = {
  ttml: "TTML",
  lrc: "LRC (lines only)",
  qrc: "QRC",
  yrc: "YRC",
  lys: "Lyricify Syllable",
  eslrc: "ESLyric",
};
import {
  type KeyAction,
  type KeyMap,
  KeysDialog,
  actionFor,
  loadKeys,
  saveKeys,
} from "./ttml-keys";
import {
  type DraftVersion,
  type SavedSong,
  addVersion,
  deleteSaves,
  listDrafts,
  listVersions,
  loadDraft,
  newVersionDue,
  savedLabel,
  writeDraft,
} from "./ttml-saves";
import { type LearnedSplits, cutAt, suggestSplit } from "./ttml-syllables";
import {
  type MenuAction,
  type SplitChoice,
  SplitDialog,
  ReadingSplitDialog,
  GeniusReview,
  ReplaceDialog,
  type ReplaceChoice,
  WordMenu,
} from "./ttml-word-menu";

const MIN_SPEED = 0.25;
const IGNORED_GENIUS = "lyssna.ttml-ignored-genius";

async function getGeniusText(title: string, artist: string) {
  const query = new URLSearchParams({ title, artist });
  const response = await fetch(`https://lyssna.org/genius?${query}`, { credentials: "omit", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error("Genius lyrics unavailable");
  const { text } = await response.json() as { text?: unknown };
  if (typeof text !== "string" || !text.trim()) throw new Error("Genius lyrics missing");
  return text;
}
const MAX_SPEED = 1.5;
const clampSpeed = (value: number) =>
  Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(value * 20) / 20));
const SPLITS_KEY = "lyssna.ttml-splits";
const SPECTROGRAM_KEY = "lyssna.ttml-spectrogram";
const SYNC_ROMAN_KEY = "lyssna.ttml-sync-roman";
const GLIDE_MS = 550;
const OFFSET_KEY = "lyssna.ttml-offset";
const CLASSIC_KEY = "lyssna.ttml-classic-tabs";
const WORD_ROMAN_KEY = "lyssna.ttml-word-roman";
type Tab = "write" | "sync" | "preview";
const HISTORY_LIMIT = 200;
const VOICE_CLASS = ["", " sung-second", " sung-third"];
const WORD_VOICE_CLASS = [" sung-first", " sung-second", " sung-third"];
const SECTION_NAMES = ["Intro", "Verse", "Pre-Chorus", "Chorus", "Post-Chorus", "Hook", "Bridge",
  "Breakdown", "Interlude", "Instrumental", "Pre-Drop", "Drop", "Post-Drop", "Outro"];

type DraftHistory = {
  lines: CreatorLine[];
  draft?: { text: string; metadata?: MetaEntry[]; appleOriginal?: Lyrics["appleOriginal"] };
};

type Drag =
  | { kind: "line"; line: number }
  | { kind: "word" | "space"; at: Cursor; group?: Cursor[] };

const firstHalf = (event: ReactDragEvent, vertical: boolean) => {
  const box = event.currentTarget.getBoundingClientRect();
  return vertical
    ? event.clientY < box.top + box.height / 2
    : event.clientX < box.left + box.width / 2;
};

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private storage is a convenience; settings still apply this session.
  }
}

const AUTHOR_KEY = "lyssna.ttml-author";
const loadAuthor = (): MetaEntry[] => {
  try {
    const author = JSON.parse(readStorage(AUTHOR_KEY) ?? "[]");
    return Array.isArray(author) ? author : [];
  } catch {
    return [];
  }
};
const contentOf = (
  lines: CreatorLine[],
  text: string,
  metadata: MetaEntry[] | undefined,
) => JSON.stringify({ lines, text, metadata });

const meta = (track: Track): SongMeta => ({
  name: track.name,
  artists: track.artists.map((artist) => artist.name),
  album: track.album?.name,
  spotifyId: track.is_local ? undefined : track.id,
  durationMs: track.duration_ms,
  songwriters: track.songwriters,
});

function TimePill({ ms, end }: { ms?: number; end?: boolean }) {
  const pill = useRef<HTMLSpanElement>(null);
  const shown = useRef(ms);
  useEffect(() => {
    if (shown.current === ms) return;
    shown.current = ms;
    if (ms === undefined || pill.current?.closest(".reduce-motion")) return;
    pill.current?.animate([{ background: "#1ed76073", color: "#fff" }, {}], {
      duration: 500,
      easing: "ease-out",
    });
  }, [ms]);
  return (
    <span
      ref={pill}
      className={`ttml-pill${end ? " end" : ""}${ms === undefined ? " empty" : ""}`}
    >
      {ms === undefined ? "--:--.---" : formatTime(ms)}
    </span>
  );
}

function CreatorTime({ playing, offset }: { playing: boolean; offset: number }) {
  const position = useCreatorClock(playing, offset);
  return <span className="ttml-time">{formatTime(position)}</span>;
}

function CreatorPreview({ lyrics, playing, offset, track, render }: {
  lyrics: Lyrics; playing: boolean; offset: number; track: Track;
  render: (lyrics: Lyrics, position: number, track: Track) => ReactNode;
}) {
  const position = useCreatorClock(playing, offset);
  return render(lyrics, position, track);
}

export function TtmlCreator({
  state,
  onPlayer,
  onToggle,
  onSpeed,
  onApply,
  onSubmit,
  onResetToSource,
  onParse,
  notify,
  renderPreview,
  barSlot,
  playbar,
  onClose,
  reviewSelection,
  onCloseReview,
  instrumentalAction,
  localIsrc,
  draftPreview = false,
}: {
  state: CreatorState;
  onPlayer: (request: PlayerRequest) => void;
  onToggle: () => void;
  onSpeed: (rate: number) => Promise<void>;
  onApply: (track: Track, filename: string, ttml: string) => Promise<boolean>;
  onSubmit: (track: Track, ttml: string, appleOriginal?: Lyrics["appleOriginal"]) => Promise<string | undefined>;
  onResetToSource: (track: Track) => Promise<Lyrics | undefined>;
  onParse: (
    filename: string,
    contents: string,
    song?: Track,
  ) => Promise<Lyrics>;
  notify: (message: string, error?: boolean) => void;
  renderPreview?: (lyrics: Lyrics, position: number, track: Track) => ReactNode;
  barSlot?: HTMLElement | null;
  playbar?: CreatorPlaybarSlots;
  onClose?: () => void;
  instrumentalAction?: ReactNode;
  reviewSelection?: ReviewSelection;
  onCloseReview?: () => void;
  localIsrc?: string;
  draftPreview?: boolean;
}) {
  const { root, view: window, waveform, playClip, recording, playingFullRecording, replayAvailable, replayCaptured, openAudio, read: readTime } = useCreatorEnvironment();
  const document = window.document;
  const focused = () => (root.getRootNode() as Document | ShadowRoot).activeElement;
  const playing = state.playback.item;
  const [track, setTrack] = useState<Track | undefined>(playing);
  useEffect(() => {
    if (!track && playing) setTrack(playing);
  }, [track, playing]);

  const [lines, setLinesRaw] = useState<CreatorLine[]>([]);
  const linesRef = useRef(lines);
  const replaceLines = useCallback((next: CreatorLine[]) => {
    linesRef.current = next;
    setLinesRaw(next);
  }, []);
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState<Cursor>({ line: 0, unit: 0 });
  const history = useRef<{ past: DraftHistory[]; future: DraftHistory[] }>({
    past: [],
    future: [],
  });
  const [offset, setOffset] = useState(
    () => Number(readStorage(OFFSET_KEY)) || 0,
  );
  const isPlaying = state.playback.is_playing;
  const here = !!track && playing?.uri === track.uri;
  const heard = state.settings.lyric_offset_ms;
  const enhancePerformance = useEnhancedPerformance();
  // Only timing boundaries change editor rows. The playhead, elapsed time,
  // and inline preview use the full clock.
  const boundaries = useMemo(() => {
    if (!enhancePerformance) return;
    const times = new Set<number>();
    for (const line of lines) {
      for (const unit of line.units) {
        if (unit.start !== undefined) times.add(unit.start);
        if (unit.end !== undefined) times.add(unit.end);
      }
    }
    return [...times].sort((left, right) => left - right);
  }, [lines, enhancePerformance]);
  const position = useCreatorClock(isPlaying, heard, !draftPreview, boundaries);
  const read = useCallback((at?: number) => readTime(at) + heard, [readTime, heard]);
  const rate = state.playback_rate;

  const [savedAt, setSavedAt] = useState<number | undefined>();
  // The content last written for `uri`, so loading or seeding a song is not
  // mistaken for an edit and only real changes get a new save time.
  const [metadata, setMetadata] = useState<MetaEntry[] | undefined>();
  const [appleOriginal, setAppleOriginal] = useState<Lyrics["appleOriginal"]>();
  const saved = useRef({ uri: "", content: "", loading: false, appleOriginal });
  const current = useRef({ uri: "", lines, text, metadata, appleOriginal });
  const versions = useRef<{ at?: number; changed: boolean }>({
    changed: false,
  });
  const snapshot = useCallback((leaving: boolean) => {
    const { uri, lines, text, metadata, appleOriginal } = current.current;
    const now = Date.now();
    if (
      !uri ||
      !versions.current.changed ||
      !newVersionDue(versions.current.at, now, leaving)
    )
      return;
    versions.current = { at: now, changed: false };
    void addVersion({ uri, savedAt: now, lines, text, metadata, appleOriginal }).catch(
      () => {},
    );
  }, []);

  useEffect(() => {
    if (!track) return;
    const draft = loadDraft(track.uri);
    const loaded = joinHyphenated(draft?.lines ?? []);
    replaceLines(loaded);
    setText(draft?.text ?? "");
    setMetadata(draft?.metadata);
    setAppleOriginal(draft?.appleOriginal);
    setSavedAt(draft?.savedAt);
    saved.current = {
      uri: track.uri,
      content: contentOf(
        draft?.lines ?? [],
        draft?.text ?? "",
        draft?.metadata,
      ),
      loading: true,
      appleOriginal: draft?.appleOriginal,
    };
    versions.current = { changed: false };
    // Opening at the song's position keeps a line picked elsewhere, such
    // as one clicked in the Lyrics page preview.
    setCursor(cursorAt(loaded, read()));
    history.current = { past: [], future: [] };
    setTextMode(false);
    return () => snapshot(true);
  }, [track, snapshot, replaceLines]);

  useEffect(() => {
    const leave = () => snapshot(true);
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, [snapshot]);

  const editedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    const lyrics = state.lyrics;
    if (
      !track ||
      !here ||
      editedFor.current === track.uri ||
      state.lyrics_uri !== track.uri ||
      !lyrics?.lines.length ||
      lyrics.instrumental ||
      !canSeed(lyrics)
    )
      return;
    if (lines.length || text.trim() || loadDraft(track.uri)) return;
    const seeded = joinHyphenated(fromLyrics(lyrics));
    if (!seeded.length) return;
    replaceLines(seeded);
    setAppleOriginal(lyrics.appleOriginal);
    setCursor(cursorAt(seeded, read()));
    setText(toText(seeded));
    saved.current.content = contentOf(seeded, toText(seeded), metadata);
    saved.current.appleOriginal = lyrics.appleOriginal;
  }, [
    track,
    here,
    state.lyrics,
    state.lyrics_uri,
    lines.length,
    text,
    metadata,
    replaceLines,
  ]);

  useEffect(() => {
    if (!track) return;
    current.current = { uri: track.uri, lines, text, metadata, appleOriginal };
    // The load above ran in this same commit; these are the previous song's.
    if (saved.current.loading) {
      saved.current.loading = false;
      return;
    }
    const content = contentOf(lines, text, metadata);
    if (saved.current.uri !== track.uri ||
      (saved.current.content === content && saved.current.appleOriginal === appleOriginal))
      return;
    saved.current.content = content;
    saved.current.appleOriginal = appleOriginal;
    versions.current.changed = true;
    if (!lines.length && !text.trim()) {
      writeDraft(track.uri, null);
      forgetWorking(track.uri);
      setSavedAt(undefined);
      return;
    }
    const now = Date.now();
    writeDraft(track.uri, {
      lines,
      text,
      metadata,
      appleOriginal,
      savedAt: now,
      song: track,
    });
    setSavedAt(now);
    markWorking(track.uri);
    snapshot(false);
  }, [track, lines, text, metadata, appleOriginal, snapshot]);

  const lastPosition = useRef<{ track: Track | undefined; position: number }>(undefined);
  useEffect(() => {
    if (draftPreview) lastPosition.current = undefined;
  }, [draftPreview]);
  useCreatorTick(isPlaying, !draftPreview, (raw) => {
    const duration = track?.duration_ms ?? 0;
    const position = raw + heard;
    const previous = lastPosition.current;
    const wrapped =
      here &&
      isPlaying &&
      duration > 5000 &&
      previous?.track === track &&
      previous.position > duration - 2500 &&
      position < 2000;
    lastPosition.current = { track, position };
    if (!wrapped) return;
    onPlayer({ command: "pause" });
    onPlayer({ command: "seek", positionMs: 0 });
  });

  const setLines = useCallback(
    (next: CreatorLine[] | ((previous: CreatorLine[]) => CreatorLine[])) => {
      const previous = linesRef.current;
      const value = joinHyphenated(typeof next === "function" ? next(previous) : next);
      if (value === previous) return;
      history.current.past = [...history.current.past.slice(-HISTORY_LIMIT), { lines: previous }];
      history.current.future = [];
      replaceLines(value);
    },
    [replaceLines],
  );
  const restoreHistory = useCallback((from: "past" | "future", to: "past" | "future") => {
    const entry = history.current[from].pop();
    if (!entry) return;
    const { text, metadata, appleOriginal } = current.current;
    history.current[to].push({ lines: linesRef.current, draft: entry.draft && { text, metadata, appleOriginal } });
    replaceLines(entry.lines);
    setCursor(at => clampCursor(entry.lines, at));
    if (entry.draft) {
      setText(entry.draft.text);
      setMetadata(entry.draft.metadata);
      setAppleOriginal(entry.draft.appleOriginal);
    }
  }, [replaceLines]);
  const undo = useCallback(() => restoreHistory("past", "future"), [restoreHistory]);
  const redo = useCallback(() => restoreHistory("future", "past"), [restoreHistory]);

  const [textMode, setTextMode] = useState(false);
  const [geniusOpen, setGeniusOpen] = useState(false);
  const [fetchingGenius, setFetchingGenius] = useState(false);
  const [geniusReview, setGeniusReview] = useState<{ uri: string; before: CreatorLine[]; applied: CreatorLine[]; text: string }>();
  const reviewingGenius = geniusReview?.uri === track?.uri ? geniusReview : undefined;
  const [ignoredGenius, setIgnoredGenius] = useState<string[]>(() => {
    try {
      const stored: unknown = JSON.parse(readStorage(IGNORED_GENIUS) ?? "[]");
      return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string") : [];
    } catch { return []; }
  });
  const reviewedChanges = useMemo(() => reviewingGenius && geniusChanges(reviewingGenius.before, lines, reviewingGenius.text), [lines, reviewingGenius]);
  const ignoreKey = (difference: GeniusChanges["differs"][number]) => JSON.stringify([track?.uri, difference.text, difference.genius]);
  const openGenius = () => {
    if (!track) return;
    const query = new URLSearchParams({ q: [track.name, ...track.artists.map(({ name }) => name)].join(" ") });
    window.open(`https://genius.com/search?${query}`, "_blank", "noopener,noreferrer");
    setTextMode(true);
    notify("Copy the plain lyrics from Genius and paste them into the editor.");
  };
  const fromGenius = async (sectionsOnly = false) => {
    if (!track || fetchingGenius) return;
    const uri = track.uri;
    const previousText = current.current.text;
    setGeniusOpen(false);
    setFetchingGenius(true);
    try {
      const found = await getGeniusText(track.name, track.artists[0]?.name ?? "");
      if (current.current.uri !== uri) return;
      if (sectionsOnly) {
        const before = current.current.lines;
        const tagged = applySections(before, found);
        if (!tagged) {
          notify("Genius has no sections that match these lines.", true);
          return;
        }
        const applied = joinHyphenated(tagged);
        setLines(applied);
        setGeniusReview({ uri, before, applied, text: found });
      } else {
        if (current.current.text !== previousText) {
          notify("Your lyrics changed while Genius was loading. Fetch again to replace the text.", true);
          return;
        }
        editedFor.current = uri;
        setAppleOriginal(undefined);
        setText(geniusBackgrounds(found.replace(/[\uE000-\uE003]/g, "")));
        setTextMode(true);
      }
    } catch {
      if (current.current.uri !== uri) return;
      notify("Couldn’t get lyrics from Genius. Open Genius and paste the lyrics or section names.", true);
      setGeniusOpen(true);
    } finally {
      setFetchingGenius(false);
    }
  };
  const geniusButton = (
    <span className="ttml-export ttml-genius">
      <button disabled={!track || fetchingGenius} onClick={() => setGeniusOpen(!geniusOpen)}
        title="Lyrics or sections from Genius" aria-label="Genius" aria-expanded={geniusOpen} aria-busy={fetchingGenius}>
        <Globe size={15} />
        <span className="ttml-label">{fetchingGenius ? "Asking Genius…" : "Genius"}</span>
      </button>
      {geniusOpen && <div className="ttml-meta-menu" role="menu">
        <button role="menuitem" onClick={() => void fromGenius()}>Lyrics from Genius</button>
        <button role="menuitem" disabled={!lines.length} onClick={() => void fromGenius(true)}>Sections from Genius</button>
        <button role="menuitem" onClick={() => { setGeniusOpen(false); openGenius(); }}>Open Genius in browser</button>
      </div>}
    </span>
  );
  const [previewOn, setPreviewOn] = useState(showsPreview);
  useEffect(() => {
    if (track) showLive(track.uri, lines);
  }, [track, lines]);
  const previewToggle = (
    <button
      aria-pressed={previewOn}
      className={previewOn ? "active" : ""}
      title="Show this draft on the Lyrics page, even before anything is saved"
      onClick={() => {
        setShowsPreview(!previewOn);
        setPreviewOn(!previewOn);
      }}
    >
      {previewOn ? <Eye size={15} /> : <EyeOff size={15} />}
      Show preview
    </button>
  );
  const [classic, setClassic] = useState(
    () => readStorage(CLASSIC_KEY) === "1",
  );
  const [tab, setTab] = useState<Tab>("write");
  const showSync = !classic || tab === "sync";
  const showEdit = !classic || tab === "write";
  // The separate Lyrics tab edits words as chips, with no timing in sight.
  const writing = classic && tab === "write";
  const writingRef = useRef(writing);
  writingRef.current = writing;
  const [wordRoman, setWordRoman] = useState(
    () => readStorage(WORD_ROMAN_KEY) === "1",
  );
  const previewing = classic && tab === "preview";
  const preview = useMemo(
    () => (previewing ? toLyrics(lines) : null),
    [previewing, lines],
  );
  // Word starts picked with Ctrl or Shift, dragged as one bunch.
  const [group, setGroup] = useState<Cursor[]>([]);
  const groupRef = useRef(group);
  groupRef.current = group;
  // Picked Space blocks, each named by the word after it.
  const [spaces, setSpaces] = useState<Cursor[]>([]);
  const spacesRef = useRef(spaces);
  spacesRef.current = spaces;
  useEffect(() => {
    setGroup([]);
    setSpaces([]);
  }, [lines]);
  // Picks are single syllables, so one syllable of a word can be picked
  // without the rest.
  const inGroup = (at: Cursor) =>
    group.some((each) => each.line === at.line && each.unit === at.unit);
  const isSpace = (at: Cursor) =>
    spaces.some((each) => each.line === at.line && each.unit === at.unit);
  const pickSpace = (event: ReactMouseEvent, at: Cursor) => {
    setPicked(new Set());
    if (event.shiftKey || event.ctrlKey || event.metaKey)
      return setSpaces(
        isSpace(at)
          ? spaces.filter(
              (each) => each.line !== at.line || each.unit !== at.unit,
            )
          : [...spaces, at],
      );
    setSpaces([at]);
    setGroup([]);
  };
  const pickWord = (at: Cursor, range: boolean) => {
    setPicked(new Set());
    const start = at;
    const base = group.length ? group : [cursor];
    if (range) {
      const from = cursor;
      const [first, last] =
        from.line < start.line ||
        (from.line === start.line && from.unit <= start.unit)
          ? [from, start]
          : [start, from];
      const picked: Cursor[] = [];
      for (let line = first.line; line <= last.line; line++)
        lines[line]?.units.forEach((unit, index) => {
          if (line === first.line && index < first.unit) return;
          if (line === last.line && index > last.unit) return;
          picked.push({ line, unit: index });
        });
      setGroup(picked);
      setSpaces(
        picked
          .slice(1)
          .filter(
            (at) => at.unit > 0 && !lines[at.line]?.units[at.unit]?.joined,
          ),
      );
      return;
    }
    const has = base.some(
      (each) => each.line === start.line && each.unit === start.unit,
    );
    setGroup(
      has
        ? base.filter(
            (each) => each.line !== start.line || each.unit !== start.unit,
          )
        : [...base, start],
    );
    setCursor(at);
  };
  const moveDragged = (
    dragged: { at: Cursor; group?: Cursor[] },
    to: Cursor,
  ) =>
    dragged.group
      ? moveWords(lines, dragged.group, to)
      : moveWord(lines, dragged.at, to);
  // A new blank line's Type word here box takes focus once it renders.
  const [focusLine, setFocusLine] = useState<number | null>(null);
  const addBlankLine = (after: number) => {
    setLines(insertBlankLine(lines, after));
    setCursor({ line: after + 1, unit: 0 });
    setFocusLine(after + 1);
  };
  useEffect(() => {
    if (focusLine === null) return;
    list.current
      ?.querySelector<HTMLInputElement>(
        `[data-line="${focusLine}"] .ttml-chip-add`,
      )
      ?.focus();
    setFocusLine(null);
  }, [focusLine, lines]);
  // Word and line drags cancel the press, which would leave the box focused.
  useEffect(() => {
    if (draftPreview) return;
    const away = (event: PointerEvent) => {
      const box = focused();
      if (
        box instanceof window.HTMLInputElement &&
        box.classList.contains("ttml-chip-add") &&
        !box.contains(event.composedPath()[0] as Node)
      )
        box.blur();
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [draftPreview]);
  const applyText = () => {
    const parsed = keepTimings(lines, parseText(text));
    const unknown = [...new Set(unknownSections(text))];
    if (unknown.length) notify(`Unrecognized section names left out: ${unknown.slice(0, 3).join(", ")}`, true);
    setLines(parsed);
    // Timing picks up at the first word still waiting for a tap.
    const line = parsed.findIndex((each) =>
      each.units.some((unit) => unit.start === undefined),
    );
    setCursor((at) =>
      line < 0
        ? clampCursor(parsed, at)
        : {
            line,
            unit: parsed[line].units.findIndex(
              (unit) => unit.start === undefined,
            ),
          },
    );
    setTextMode(false);
  };
  const openText = () => {
    setText(toText(lines));
    setTextMode(true);
  };
  // The word being retyped in its own box after a double-click.
  const [inline, setInline] = useState<Cursor | null>(null);
  const commitWord = (at: Cursor, value: string) => {
    const next = editUnit(lines, at, value);
    if (next === lines) return;
    setLines(next);
    setCursor((cursor) => clampCursor(next, cursor));
  };

  const [learned, setLearned] = useState<LearnedSplits>(() => {
    try {
      return JSON.parse(readStorage(SPLITS_KEY) ?? "{}") as LearnedSplits;
    } catch {
      return {};
    }
  });
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    at: Cursor;
    kind?: "line" | "section";
  } | null>(null);
  const [splitting, setSplitting] = useState<Cursor | null>(null);
  const [splittingReading, setSplittingReading] = useState<Cursor | null>(null);
  const [sectionEdit, setSectionEdit] = useState<{ line: number; part: string; singer: string }>();
  const sectionNames = useId();
  const editSection = (line: number) => setSectionEdit({
    line,
    part: lines[line]?.part ?? "",
    singer: lines[sectionStart(lines, line)]?.singer ?? "",
  });
  const [replacing, setReplacing] = useState<Cursor | null>(null);
  const openMenu = (event: ReactMouseEvent, at: Cursor) => {
    event.preventDefault();
    setCursor(at);
    setMenu({ x: event.clientX, y: event.clientY, at });
  };
  const openLineMenu = (event: ReactMouseEvent, line: number) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    setCursor(clampCursor(lines, { line, unit: 0 }));
    setMenu({
      x: event.clientX,
      y: event.clientY,
      at: { line, unit: 0 },
      kind: "line",
    });
  };
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  const pickedFrom = useRef(0);
  useEffect(() => setPicked(new Set()), [lines.length, track]);
  const pick = (index: number, range: boolean) => {
    setGroup([]);
    setSpaces([]);
    const anchor = picked.size ? pickedFrom.current : cursor.line;
    const [from, to] = [anchor, index].sort((a, b) => a - b);
    pickedFrom.current = index;
    setPicked((old) => {
      const next = new Set(old);
      if (range) for (let at = from; at <= to; at++) next.add(at);
      else if (!next.delete(index)) next.add(index);
      return next;
    });
  };
  // Ctrl-click adds or removes a line and Shift-click adds a range.
  const pickProps = (index: number) => ({
    onMouseDown: (event: ReactMouseEvent) => {
      if (event.shiftKey || event.ctrlKey || event.metaKey)
        event.preventDefault();
    },
    onClickCapture: (event: ReactMouseEvent<HTMLDivElement>) => {
      if (
        (event.shiftKey || event.ctrlKey || event.metaKey) &&
        !(event.target as Element).closest(
          ".ttml-unit, .ttml-chip, .ttml-space",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        pick(index, event.shiftKey);
      }
    },
  });
  const flagLine = (index: number, key: "background" | "opposite") =>
    setLines(
      picked.has(index)
        ? setLineFlag(lines, picked, key, !lines[index][key])
        : toggleLine(lines, index, key),
    );
  const [shiftBy, setShiftBy] = useState(0);
  const allPicked = (key: "background" | "opposite") =>
    [...picked].every((index) => lines[index]?.[key]);
  const pickBar = picked.size > 0 && (
    <div className="ttml-pick-bar" role="toolbar" aria-label="Selected lines">
      <strong>
        {picked.size} line{picked.size === 1 ? "" : "s"} selected
      </strong>
      <button
        className={allPicked("background") ? "active" : ""}
        aria-pressed={allPicked("background")}
        onClick={() =>
          setLines(
            setLineFlag(lines, picked, "background", !allPicked("background")),
          )
        }
      >
        Background
      </button>
      <button
        className={allPicked("opposite") ? "active" : ""}
        aria-pressed={allPicked("opposite")}
        onClick={() =>
          setLines(
            setLineFlag(lines, picked, "opposite", !allPicked("opposite")),
          )
        }
      >
        Second singer
      </button>
      <label className="ttml-offset">
        Shift
        <input
          type="number"
          step={10}
          value={shiftBy}
          aria-label="Shift selected lines by milliseconds"
          onChange={(event) => setShiftBy(Number(event.target.value) || 0)}
        />
        ms
      </label>
      <button
        disabled={!shiftBy}
        onClick={() => setLines(shiftLines(lines, picked, shiftBy))}
      >
        Shift timing
      </button>
      <button onClick={() => setLines(clearLines(lines, picked))}>
        Clear timing
      </button>
      <button
        className="danger"
        onClick={() => restructure(removeLines(lines, picked))}
      >
        <Trash2 size={14} />
        Delete
      </button>
      <span className="ttml-pick-end">
        <button
          onClick={() => setPicked(new Set(lines.map((_, index) => index)))}
        >
          Select all
        </button>
        <button onClick={() => setPicked(new Set())}>Deselect</button>
      </span>
    </div>
  );
  const restructure = (next: CreatorLine[]) => {
    if (next === lines) return;
    setLines(next);
    setCursor((cursor) => clampCursor(next, cursor));
  };
  const [romanNote, setRomanNote] = useState("");
  const [syncRoman, setSyncRoman] = useState(
    () => readStorage(SYNC_ROMAN_KEY) === "1",
  );
  const autoRomanize = async () => {
    const source = current.current.uri;
    const request = romanizeRequest(lines);
    setRomanNote("Romanizing…");
    const [result, genius] = await Promise.all([
      romanizeLyrics(request, state.settings.romaji_as_written).catch(() => null),
      track && request.lines.some(line => /[^\p{Script=Latin}\p{Number}\p{Punctuation}\s]/u.test(line.text))
        ? getGeniusText(`${track.name} (Romanized)`, "Genius Romanizations").catch(() => "")
        : "",
    ]);
    if (source !== current.current.uri) {
      setRomanNote("");
      return;
    }
    if (!result) {
      setRomanNote("Couldn’t romanize these lyrics. Try again.");
      return;
    }
    const found = result.lines.some((line, lineIndex) =>
      line.words.some(
        (word, index) =>
          word.text.trim() !==
          request.lines[lineIndex]?.words[index]?.text.trim(),
      ),
    );
    setRomanNote(
      found
        ? ""
        : "Nothing to romanize: these lyrics are already in Latin letters.",
    );
    if (!found) return;
    const reading = genius ? readingsFrom(request, result, genius.replace(/[\uE000-\uE003]/g, "")).lyrics : result;
    setLines((current) => applyRomanized(current, request, reading));
  };
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState("");
  const dragScroll = useRef({ speed: 0, frame: 0 });
  useEffect(() => {
    const scroll = dragScroll.current;
    return () => cancelAnimationFrame(scroll.frame);
  }, []);
  const endDrag = () => {
    setDrag(null);
    setDrop("");
    dragScroll.current.speed = 0;
  };
  const scrollWhileDragging = (event: ReactDragEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const edge = Math.min(90, box.height / 4);
    const reach = (distance: number) =>
      Math.min(1, 1 - distance / edge) ** 2 * 22;
    const scroll = dragScroll.current;
    scroll.speed =
      event.clientY - box.top < edge
        ? -reach(event.clientY - box.top)
        : box.bottom - event.clientY < edge
          ? reach(box.bottom - event.clientY)
          : 0;
    if (!scroll.speed || scroll.frame) return;
    const element = event.currentTarget;
    const step = () => {
      if (!scroll.speed) {
        scroll.frame = 0;
        return;
      }
      element.scrollTop += scroll.speed;
      scroll.frame = requestAnimationFrame(step);
    };
    scroll.frame = requestAnimationFrame(step);
  };
  const startDrag = (event: ReactDragEvent, next: Drag) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", "");
    if (next.kind === "word") {
      // Shows every word being moved, not just the block under the pointer.
      const units = lines[next.at.line]?.units ?? [];
      const { start, end } = wordBounds(units, next.at.unit);
      const text = next.group
        ? [...next.group]
            .sort((a, b) => a.line - b.line || a.unit - b.unit)
            .map((at) => lines[at.line]?.units[at.unit]?.text ?? "")
            .join(" ")
        : units
            .slice(start, end)
            .map((unit) => unit.text)
            .join("");
      const ghost = document.createElement("div");
      ghost.className = "ttml-drag-ghost";
      ghost.textContent = text;
      root.append(ghost);
      event.dataTransfer.setDragImage(ghost, 12, 16);
      setTimeout(() => ghost.remove());
    }
    setDrag(next);
  };
  // The picked words, or the selected word when none are picked.
  const pickedWords = () => (group.length ? group : [cursor]);
  const dragWords = (event: ReactDragEvent, at: Cursor) => {
    const words = pickedWords();
    const carry = words.some(
      (each) => each.line === at.line && each.unit === at.unit,
    );
    startDrag(
      event,
      carry && words.length > 1
        ? { kind: "word", at, group: words }
        : { kind: "word", at },
    );
  };
  const over = (event: ReactDragEvent, key: string) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDrop(key);
  };
  const land = (event: ReactDragEvent, next: CreatorLine[]) => {
    event.preventDefault();
    event.stopPropagation();
    endDrag();
    restructure(next);
  };
  const dropClass = (key: string) =>
    drop.startsWith(`${key}:`) ? ` drop-${drop.slice(key.length + 1)}` : "";
  const voiceGroup = (index: number): MenuAction[][] => {
    const voices = sectionVoices(lines, index);
    if (!voices.length) return [];
    const currentVoice = lineVoice(lines, index);
    const targets = picked.has(index) ? picked : [index];
    return [voices.map((voice, at) => ({
      label: `Line sung by ${voice}`,
      checked: at === currentVoice,
      run: () => setLines(setLineVoice(lines, targets, voice)),
    }))];
  };
  const wordVoiceGroup = (at: Cursor, targets: Cursor[]): MenuAction[][] => {
    const voices = sectionVoices(lines, at.line);
    if (!voices.length) return [];
    const own = unitVoice(lines, at);
    const currentVoice = own >= 0 ? own : lineVoice(lines, at.line);
    return [voices.map((voice, index) => ({
      label: `${targets.length > 1 ? "Words" : "Word"} sung by ${voice}`,
      checked: index === currentVoice,
      run: () => setLines(setUnitVoice(lines, targets, voice)),
    }))];
  };
  const lineMenuGroups = (index: number): MenuAction[][] => {
    const line = lines[index];
    if (!line) return [];
    const addAt = (after: number) => {
      setLines(insertBlankLine(lines, after));
      setCursor({ line: after + 1, unit: 0 });
      setFocusLine(after + 1);
    };
    const span = lineSpan(line);
    return [
      [
        { label: "Insert line above", run: () => addAt(index - 1) },
        { label: "Insert line below", run: () => addAt(index) },
        {
          label: "Duplicate line",
          run: () => setLines(duplicateLine(lines, index)),
        },
      ],
      [
        {
          label: "Background vocal",
          checked: line.background,
          run: () => flagLine(index, "background"),
        },
        ...(!sectionVoices(lines, index).length ? [{
          label: "Second singer",
          checked: line.opposite,
          run: () => flagLine(index, "opposite"),
        }] : []),
      ],
      ...voiceGroup(index),
      [{
        label: line.part ? "Edit section" : "Start section here",
        run: () => editSection(index),
      }, ...(line.part ? [{ label: "Remove section", run: () => setLines(setSection(lines, index)) }] : [])],
      [
        {
          label: "Play from this line",
          disabled: !span,
          run: () => span && seek(span.start),
        },
        {
          label: "Clear line timing",
          disabled: !span,
          run: () => setLines(clearLines(lines, new Set([index]))),
        },
      ],
      [
        {
          label: "Delete line",
          run: () => restructure(removeLine(lines, index)),
        },
      ],
    ];
  };
  const menuGroups = (at: Cursor): MenuAction[][] => {
    const line = lines[at.line];
    const unit = line?.units[at.unit];
    if (!line || !unit) return [];
    const suggestion = suggestSplit(unit.text, learned);
    const chosen =
      group.length > 1 &&
      group.some((each) => each.line === at.line && each.unit === at.unit);
    const firstChosen = Math.min(
      ...group.filter((each) => each.line === at.line).map((each) => each.unit),
    );
    return [
      [
        { label: "Split word…", run: () => syncRoman && unit.roman ? setSplittingReading(at) : setSplitting(at) },
        ...(!syncRoman && unit.roman ? [{ label: "Split reading…", run: () => setSplittingReading(at) }] : []),
        {
          label: "Auto-segment word",
          disabled: !suggestion.length,
          run: () =>
            restructure(splitUnit(lines, at, cutAt(unit.text, suggestion))),
        },
        {
          label: "Replace word…",
          run: () => setReplacing(at),
        },
        ...(at.unit > 0
          ? [
              {
                label: unit.joined
                  ? "Space before this syllable"
                  : "Join to the word before",
                run: () => setLines(toggleJoin(lines, at)),
              },
            ]
          : []),
        { label: "Delete word", run: () => commitWord(at, "") },
      ],
      [
        {
          label: "Move following words to new line",
          disabled: (chosen ? firstChosen : at.unit) === 0,
          run: () => restructure(breakLine(lines, at, false, group)),
        },
        {
          label: chosen
            ? "Move selected words to new line"
            : "Move this word to new line",
          disabled: !chosen && line.units.length < 2,
          run: () => restructure(breakLine(lines, at, true, group)),
        },
      ],
      [
        {
          label: "Background line",
          checked: line.background,
          run: () => setLines(toggleLine(lines, at.line, "background")),
        },
        ...(!sectionVoices(lines, at.line).length ? [{
          label: "Duet line",
          checked: line.opposite,
          run: () => setLines(toggleLine(lines, at.line, "opposite")),
        }] : []),
      ],
      ...wordVoiceGroup(at, chosen ? group : [at]),
      ...voiceGroup(at.line),
      [
        {
          label: "Insert new line before",
          run: () => {
            addBlankLine(at.line - 1);
          },
        },
        {
          label: "Insert new line after",
          run: () => {
            addBlankLine(at.line);
          },
        },
        {
          label: "Duplicate line",
          run: () => restructure(duplicateLine(lines, at.line)),
        },
        {
          label: "Delete line",
          run: () => restructure(removeLine(lines, at.line)),
        },
      ],
    ];
  };
  const confirmReplace = (at: Cursor, choice: ReplaceChoice) => {
    const unit = lines[at.line]?.units[at.unit];
    setReplacing(null);
    if (!unit) return;
    if (!choice.replaceAll) return commitWord(at, choice.value);
    restructure(
      replaceMatching(lines, unit.text, choice.value, choice.matchCase),
    );
  };
  const confirmSplit = (at: Cursor, choice: SplitChoice) => {
    const unit = lines[at.line]?.units[at.unit];
    setSplitting(null);
    if (!unit) return;
    if (choice.learned) {
      const next = { ...learned, [choice.learned.key]: choice.learned.offsets };
      setLearned(next);
      writeStorage(SPLITS_KEY, JSON.stringify(next));
    }
    restructure(
      choice.applyAll
        ? splitMatching(
            lines,
            unit.text,
            (text) =>
              cutAt(
                text,
                text === unit.text
                  ? choice.offsets
                  : choice.offsets.filter((at) => at < Array.from(text).length),
              ),
            choice.ignoreCase,
          )
        : splitUnit(lines, at, cutAt(unit.text, choice.offsets)),
    );
  };
  const seedable = here && state.lyrics_uri === track?.uri && !!state.lyrics?.lines.length && canSeed(state.lyrics);
  const seedHint = seedable
    ? state.lyrics?.estimated_words ? "Estimated word timings you can edit" : `Use the lyrics from ${state.lyrics?.source}`
    : !here ? "Play this song to look up its lyrics"
      : state.lyrics_pending ? "Looking up lyrics…" : "No lyrics found from Creator sources";
  const startFromLyrics = () => {
    if (!state.lyrics || !seedable) return;
    const seeded = fromLyrics(state.lyrics);
    setAppleOriginal(state.lyrics.appleOriginal);
    setLines(seeded);
    setText(toText(seeded));
    setCursor({ line: 0, unit: 0 });
  };
  const [resettingSource, setResettingSource] = useState(false);
  const [checkedSource, setCheckedSource] = useState<{ uri: string; basedOn?: Lyrics; content: string }>();
  const availableSource = state.lyrics_uri === track?.uri && state.lyrics?.lines.length &&
    state.lyrics.source !== "Imported TTML" && state.lyrics.source !== "Imported LRC" ? state.lyrics : undefined;
  const availableSourceContent = useMemo(() => availableSource &&
    contentOf(joinHyphenated(fromLyrics(availableSource)), "", undefined), [availableSource]);
  const draftLinesContent = useMemo(() => contentOf(lines, "", undefined), [lines]);
  const sourceContent = checkedSource && checkedSource.uri === track?.uri && checkedSource.basedOn === state.lyrics
    ? checkedSource.content : availableSourceContent;
  const resetLabel = resettingSource ? "Finding source…" : sourceContent === draftLinesContent ? "Already showing source" : "Reset to source";
  const [clearArmed, setClearArmed] = useState(false);
  useEffect(() => {
    if (!clearArmed) return;
    const timer = window.setTimeout(() => setClearArmed(false), 3000);
    return () => window.clearTimeout(timer);
  }, [clearArmed, window]);
  useEffect(() => { setClearArmed(false); setSectionEdit(undefined); setSplittingReading(null); }, [track?.uri]);
  const clearDraft = () => {
    if (!track || !here) return;
    if (!clearArmed) {
      setClearArmed(true);
      return;
    }
    history.current.past = [...history.current.past.slice(-HISTORY_LIMIT), {
      lines, draft: { text, metadata, appleOriginal },
    }];
    history.current.future = [];
    editedFor.current = track.uri;
    replaceLines([]);
    setText("");
    setMetadata(undefined);
    setAppleOriginal(undefined);
    setCursor({ line: 0, unit: 0 });
    setClearArmed(false);
    notify("Draft cleared. Earlier saves are still under Saves.");
  };
  const draftActions = <>
    {instrumentalAction}
    {!textMode && <button type="button" disabled={!lines.length} onClick={() => {
      const next = bracketsToBackground(lines);
      if (next === lines) { notify("No words in brackets to move."); return; }
      restructure(next);
      notify("Moved bracketed lyrics to background vocals.");
    }}>Brackets to background</button>}
    <button type="button" className={clearArmed ? "danger" : undefined} onClick={clearDraft}
      disabled={!here || (!lines.length && !text.trim() && !metadata)}>
      <Trash2 size={15} aria-hidden="true" />{clearArmed ? "Click again to clear" : "Clear draft"}
    </button>
  </>;
  const resetToSource = async () => {
    if (!track || !here || resettingSource) return;
    const draft = current.current;
    setResettingSource(true);
    try {
      const lyrics = await onResetToSource(track);
      const latest = current.current;
      if (!root.isConnected || latest.uri !== draft.uri) return;
      if (linesRef.current !== draft.lines || latest.text !== draft.text ||
        latest.metadata !== draft.metadata || latest.appleOriginal !== draft.appleOriginal) {
        notify("The draft changed while looking up source lyrics.", true);
        return;
      }
      if (!lyrics?.lines.length) {
        notify("No source lyrics found for this song.", true);
        return;
      }
      const seeded = joinHyphenated(fromLyrics(lyrics));
      if (!seeded.length) {
        notify("The source has no editable lyric lines.", true);
        return;
      }
      const content = contentOf(seeded, "", undefined);
      setCheckedSource({ uri: draft.uri, basedOn: state.lyrics, content });
      if (draftLinesContent === content && (!textMode || draft.text === toText(seeded))) {
        notify("Already showing source.");
        return;
      }
      history.current.past = [...history.current.past.slice(-HISTORY_LIMIT), {
        lines: draft.lines, draft: { text: draft.text, metadata: draft.metadata, appleOriginal: draft.appleOriginal },
      }];
      history.current.future = [];
      editedFor.current = track.uri;
      replaceLines(seeded);
      setText(toText(seeded));
      setMetadata(undefined);
      setAppleOriginal(lyrics.appleOriginal);
      setCursor(cursorAt(seeded, read()));
      setGroup([]);
      setSpaces([]);
      setPicked(new Set());
      notify(`Reset to ${lyrics.source}. ${MODIFIER}+Z restores the previous draft.`);
    } catch {
      if (root.isConnected && current.current.uri === draft.uri) notify("Couldn’t load source lyrics. Try again.", true);
    } finally {
      if (root.isConnected) setResettingSource(false);
    }
  };

  const tap = useCallback(
    (at?: number) => Math.round(read(at) + offset),
    [read, offset],
  );
  const seek = useCallback(
    (ms: number) =>
      onPlayer({ command: "seek", positionMs: Math.max(0, Math.round(ms)) }),
    [onPlayer],
  );
  const playUnit = useCallback(
    (at: Cursor) => {
      const unit = lines[at.line]?.units[at.unit];
      const range = unit?.start !== undefined && unit.end !== undefined
        ? { start: unit.start, end: unit.end }
        : lines[at.line] && lineSpan(lines[at.line]);
      if (!track || !here || !range || range.end <= range.start) return;
      setCursor(at);
      playClip(track.uri, Math.max(0, range.start - heard), Math.max(0, range.end - heard));
    },
    [lines, track, here, playClip, heard],
  );
  const changeSpeed = useCallback(
    (next: number) => {
      if (state.speedEnabled) void onSpeed(next).catch((error) => notify(String(error), true));
      else if (here && replayAvailable) replayCaptured(next);
    },
    [onSpeed, notify, state.speedEnabled, here, replayAvailable, replayCaptured],
  );
  const [speedDraft, setSpeedDraft] = useState<number | null>(null);
  const speedTimer = useRef(0);
  const slideSpeed = (value: number) => {
    setSpeedDraft(value);
    clearTimeout(speedTimer.current);
    speedTimer.current = window.setTimeout(() => {
      changeSpeed(value);
      speedTimer.current = window.setTimeout(() => setSpeedDraft(null), 1000);
    }, 120);
  };
  useEffect(() => () => clearTimeout(speedTimer.current), []);
  const shownSpeed = speedDraft ?? rate;

  const [keys, setKeys] = useState<KeyMap>(loadKeys);
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const [editingKeys, setEditingKeys] = useState(false);
  const [touring, setTouring] = useState(false);
  // The list holds still during the walkthrough so its highlights stay put.
  const touringRef = useRef(touring);
  touringRef.current = touring;
  const changeKeys = useCallback((next: KeyMap) => {
    setKeys(next);
    saveKeys(next);
  }, []);
  // Drafts already save on every edit; Ctrl+S keeps a version now and
  // confirms it.
  const saveNow = useRef(() => {});
  saveNow.current = () => {
    if (!current.current.uri || !savedAt) return;
    snapshot(true);
    setSavedAt(Date.now());
  };
  const stateRef = useRef({ lines, cursor });
  stateRef.current = { lines, cursor };
  const wordField = useRef<HTMLInputElement>(null);
  const scrolledAt = useRef(0);
  const revealTimingWord = useRef(false);
  const editable = !draftPreview && !textMode && lines.length > 0 && !previewing;
  useEffect(() => {
    if (!track || draftPreview || textMode || previewing) return;
    const pressed = new Set<string>();
    const onHistoryKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const release = event.type === "keyup";
      // Spotify sometimes consumes keydown. Handle a lone keyup once.
      if (release && pressed.delete(key)) return;
      if (event.isComposing || event.altKey || !(IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) return;
      if (!release) pressed.add(key);

      const target = event.composedPath()[0];
      if (!(target instanceof window.Element)) return;
      const emptyAdder = target instanceof window.HTMLInputElement &&
        target.classList.contains("ttml-chip-add") && !target.value;
      if (!emptyAdder && target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
      if (target.closest(".lyrics-settings-backdrop, .ttml-recording-popover, .ttml-spectrum-menu, .review-panel") ||
        root.querySelector(".ttml-menu, .ttml-dialog")) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      if (emptyAdder) target.blur();
      if (key === "y" || event.shiftKey) redo();
      else undo();
    };
    const clearPressed = () => pressed.clear();
    window.addEventListener("keydown", onHistoryKey, true);
    window.addEventListener("keyup", onHistoryKey, true);
    window.addEventListener("blur", clearPressed);
    return () => {
      window.removeEventListener("keydown", onHistoryKey, true);
      window.removeEventListener("keyup", onHistoryKey, true);
      window.removeEventListener("blur", clearPressed);
    };
  }, [track, draftPreview, textMode, previewing, root, window, undo, redo]);
  useEffect(() => {
    if (!editable || readStorage(TOUR_KEY)) return;
    // Seen once is enough, even if the walkthrough is never finished.
    writeStorage(TOUR_KEY, "1");
    setTouring(true);
  }, [editable]);
  const endTour = useCallback(() => {
    setTouring(false);
    writeStorage(TOUR_KEY, "1");
  }, []);
  const selectedLine = lines[cursor.line];
  const selectedUnit = selectedLine?.units[cursor.unit];
  // Enter keeps an edit and Escape drops it; either way the keys go back
  // to timing.
  const leaveField = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape")
      event.currentTarget.value = event.currentTarget.defaultValue;
    event.currentTarget.blur();
  };
  useEffect(() => {
    if (!editable) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Space" || event.key === " ") return;
      const deleteKey = event.key === "Delete" || event.code === "Delete";
      // Spotify can deliver Delete's release without its initial keydown.
      if (deleteKey !== (event.type === "keyup")) return;
      const target = event.composedPath()[0] as HTMLElement | null;
      if (deleteKey && !root.contains(target)) return;
      if (target?.closest(".lyrics-settings-backdrop, .ttml-recording-popover, .ttml-spectrum-menu, .review-panel")) return;
      if (root.querySelector(".ttml-menu, .ttml-dialog")) return;
      if (target?.closest(".ttml-bar button, .ttml-spectrum button") && event.key === "Enter") return;
      if (
        (IS_MAC ? event.metaKey : event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "s"
      ) {
        event.preventDefault();
        event.stopPropagation();
        saveNow.current();
        return;
      }
      // Shortcuts take Cmd on macOS, where Ctrl is no modifier of ours.
      if (
        target?.closest("input, textarea, select, [contenteditable=true]") ||
        event.altKey ||
        (IS_MAC ? event.ctrlKey : event.metaKey)
      )
        return;
      const { lines, cursor } = stateRef.current;
      const ctrl = IS_MAC ? event.metaKey : event.ctrlKey;
      const key = event.key.toLowerCase();
      const erase = deleteKey || event.key === "Backspace";
      const words = groupRef.current,
        gaps = spacesRef.current;
      const pickedLines = pickedRef.current;
      let handled = true;
      if (!ctrl && erase && pickedLines.size) {
        const next = removeLines(lines, pickedLines);
        setLines(next);
        setCursor(clampCursor(next, cursor));
        setPicked(new Set());
      } else if (
        (ctrl && erase) ||
        (!ctrl && deleteKey)
      ) {
        const next =
          words.length || gaps.length
            ? deletePicked(lines, words, gaps)
            : editUnit(lines, cursor, "");
        setLines(next);
        setCursor(clampCursor(next, cursor));
        setGroup([]);
        setSpaces([]);
      } else if (ctrl && key === "e") {
        if (writingRef.current) setInline(cursor);
        else wordField.current?.focus();
      } else if (ctrl && key === "a") {
        // First the current line's words, then every line.
        const all =
          lines[cursor.line]?.units.map((_, unit) => ({
            line: cursor.line,
            unit,
          })) ?? [];
        const whole =
          all.length > 0 &&
          words.length === all.length &&
          words.every((each) => each.line === cursor.line);
        setSpaces([]);
        if (whole || !all.length) {
          setGroup([]);
          setPicked(new Set(lines.map((_, index) => index)));
        } else {
          setPicked(new Set());
          setGroup(all);
        }
      } else if (ctrl && key === "d" && lines[cursor.line]) {
        setLines(duplicateLine(lines, cursor.line));
        setCursor({ line: cursor.line + 1, unit: cursor.unit });
      } else if (ctrl) handled = false;
      else if (writingRef.current && erase) {
        const next =
          words.length || gaps.length
            ? deletePicked(lines, words, gaps)
            : editUnit(lines, cursor, "");
        setLines(next);
        setCursor(clampCursor(next, cursor));
        setGroup([]);
        setSpaces([]);
      } else if (event.key === "F2") {
        if (writingRef.current) setInline(cursor);
        else wordField.current?.focus();
      } else if (event.key === "Enter") {
        // Enter on a focused button presses it.
        if (target?.closest("button, a")) handled = false;
        else if (writingRef.current && lines[cursor.line]?.units[cursor.unit])
          setInline(cursor);
        else {
          setLines(insertBlankLine(lines, cursor.line));
          setCursor({ line: cursor.line + 1, unit: 0 });
          setFocusLine(cursor.line + 1);
        }
      } else if (event.key === "Escape") {
        setGroup([]);
        setSpaces([]);
        setPicked(new Set());
      } else if (event.key === "ArrowLeft" && event.shiftKey)
        seek(read() - 3000);
      else if (event.key === "ArrowRight" && event.shiftKey)
        seek(read() + 3000);
      else if (!showSync && !event.key.startsWith("Arrow")) handled = false;
      else {
        const arrows: Record<string, KeyAction> = {
          ArrowLeft: "previous",
          ArrowRight: "following",
          ArrowUp: "lineUp",
          ArrowDown: "lineDown",
          Backspace: "clear",
        };
        const action = arrows[event.key] ?? actionFor(keysRef.current, key);
        const timing = ["start", "next", "end"].includes(action ?? "");
        if (action === "previous")
          setCursor(previousCursor(lines, cursor) ?? cursor);
        else if (action === "following")
          setCursor(nextCursor(lines, cursor) ?? cursor);
        else if (action === "lineUp")
          setCursor(clampCursor(lines, { line: cursor.line - 1, unit: 0 }));
        else if (action === "lineDown")
          setCursor(clampCursor(lines, { line: cursor.line + 1, unit: 0 }));
        else if (action === "normalSpeed") changeSpeed(1);
        else if (action === "slower") changeSpeed(clampSpeed(rate - 0.05));
        else if (action === "faster") changeSpeed(clampSpeed(rate + 0.05));
        else if (!action || !here || !lines.length) handled = false;
        else if (action === "jumpBack" || action === "jumpForward") {
          const to =
            (action === "jumpBack"
              ? previousCursor(lines, cursor)
              : nextCursor(lines, cursor)) ?? cursor;
          setCursor(to);
          const start = lines[to.line]?.units[to.unit]?.start;
          if (start !== undefined) seek(start);
        } else if (event.repeat && timing) handled = true;
        else if (action === "start") {
          const time = tap(event.timeStamp);
          const at = timingCursor(lines, cursor, time);
          setLines(markStart(lines, at, time));
          if (at !== cursor) setCursor(at);
        }
        else if (action === "next" || action === "end") {
          const mark = action === "next" ? markNext : markEnd;
          const time = tap(event.timeStamp);
          const result = mark(lines, timingCursor(lines, cursor, time), time);
          if (result.lines !== lines) {
            scrolledAt.current = Date.now();
            revealTimingWord.current = true;
          }
          setLines(result.lines);
          setCursor(result.cursor);
        } else if (action === "replay") {
          const line = lines[cursor.line];
          const before = lines[cursor.line - 1];
          const from =
            (line && lineSpan(line)?.start) ??
            (before && lineSpan(before)?.end) ??
            read();
          seek(from - 2000);
        } else if (action === "clear") setLines(clearTiming(lines, cursor));
        else handled = false;
      }
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
    };
  }, [
    editable,
    showSync,
    here,
    tap,
    read,
    seek,
    setLines,
    changeSpeed,
    rate,
  ]);

  const list = useRef<HTMLDivElement>(null);
  const glide = useRef(0);
  const reduceMotion = !!state.settings.reduce_motion;
  const centre = useCallback(
    (index: number, instant = false) => {
      const container = list.current;
      const line = container?.querySelector<HTMLElement>(
        `[data-line="${index}"]`,
      );
      if (!container || !line) return;
      cancelAnimationFrame(glide.current);
      const box = container.getBoundingClientRect();
      const row = line.getBoundingClientRect();
      const from = container.scrollTop;
      const to = Math.max(
        0,
        Math.min(
          container.scrollHeight - container.clientHeight,
          from + row.top - box.top - (box.height - row.height) / 2,
        ),
      );
      if (instant || reduceMotion || Math.abs(to - from) < 1) {
        container.scrollTop = to;
        return;
      }
      const start = performance.now();
      const step = (time: number) => {
        const t = Math.min(1, (time - start) / GLIDE_MS);
        const eased = 1 - Math.pow(1 - t, 3);
        container.scrollTop = from + (to - from) * eased;
        if (t < 1) glide.current = requestAnimationFrame(step);
      };
      glide.current = requestAnimationFrame(step);
    },
    [reduceMotion],
  );
  useEffect(() => () => cancelAnimationFrame(glide.current), []);
  // A line picked with the mouse is already in view; scrolling it to the
  // middle would move the word away from the pointer.
  const clickedLine = useRef(false);
  useEffect(() => {
    if (clickedLine.current) {
      clickedLine.current = false;
      return;
    }
    if (touringRef.current || revealTimingWord.current) return;
    centre(cursor.line);
  }, [cursor.line, centre]);
  useEffect(() => {
    if (!revealTimingWord.current) return;
    revealTimingWord.current = false;
    cancelAnimationFrame(glide.current);
    if (touringRef.current) return;
    const container = list.current;
    const word = container?.querySelector(".ttml-unit[aria-current='true']");
    if (!container || !word) return;
    const viewport = container.getBoundingClientRect();
    const selection = word.getBoundingClientRect();
    if (selection.top < viewport.top || selection.bottom > viewport.bottom) {
      container.scrollTop += (selection.top + selection.bottom - viewport.top - viewport.bottom) / 2;
    }
  }, [lines, cursor]);

  const shownWord = useRef<(Cursor & { start: number }) | null>(null);
  const liveWord = useMemo(() => {
    let next: (Cursor & { start: number }) | null = null;
    lines.forEach((line, lineIndex) =>
      line.units.forEach((unit, unitIndex) => {
        if (
          unit.start !== undefined &&
          unit.end !== undefined &&
          position >= unit.start &&
          position < unit.end
        )
          next = { line: lineIndex, unit: unitIndex, start: unit.start };
      }),
    );
    const shown = shownWord.current;
    const found = next as (Cursor & { start: number }) | null;
    // The clock can step back a few ms; only a real seek lights an earlier word.
    if (
      shown &&
      found &&
      found.start < shown.start &&
      shown.start - position < 250
    )
      return shown;
    shownWord.current = found;
    return found;
  }, [lines, position]);
  // Overlapping lines, like a second singer or background vocals, sing
  // together, so every word under the playhead lights up.
  const liveWords = useMemo(
    () => singingAt(lines, position),
    [lines, position],
  );
  const [peaks, setPeaks] = useState<{
    uri: string;
    values: Uint8Array;
  } | null>(null);
  const trackUri = track?.uri;
  const [spectrogram, setSpectrogram] = useState(
    () => readStorage(SPECTROGRAM_KEY) === "1",
  );
  const spectrogramId = useId();
  const showSpectrogram = (on: boolean) => {
    setSpectrogram(on);
    writeStorage(SPECTROGRAM_KEY, on ? "1" : null);
  };
  useEffect(() => {
    if (!barSlot || !trackUri) return;
    let current = true;
    waveform(trackUri, 2400)
      .then((values) => { if (current) setPeaks({ uri: trackUri, values }); })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [barSlot, trackUri, waveform]);
  const barSpans = useMemo(
    () =>
      lines.flatMap((line, index) => {
        if (index !== cursor.line && !picked.has(index)) return [];
        const span = lineSpan(line);
        return span ? [{ ...span, current: true }] : [];
      }),
    [lines, cursor.line, picked],
  );
  const playingLine = useMemo(() => {
    let found = -1;
    lines.forEach((line, index) => {
      const span = lineSpan(line);
      if (span && span.start <= position) found = index;
    });
    return found;
  }, [lines, position]);
  // Clicking a line in the preview seeks there, so coming back from it
  // picks up at the line and word the song is on.
  const selectPlaying = () => {
    if (playingLine >= 0) setCursor(cursorAt(lines, read()));
  };
  const typingInCreator = () => {
    const box = focused();
    return (
      (box instanceof window.HTMLTextAreaElement ||
        (box instanceof window.HTMLInputElement &&
          /^(text|search|number|)$/.test(box.type))) &&
      !!box.closest(".ttml-creator")
    );
  };
  // Playback doesn't pull the list away from words being worked on.
  const working =
    inline !== null ||
    menu !== null ||
    splitting !== null ||
    splittingReading !== null ||
    !!sectionEdit ||
    !!reviewingGenius ||
    replacing !== null ||
    picked.size > 0 ||
    group.length > 0 ||
    spaces.length > 0 ||
    drag !== null;
  const workingRef = useRef(working);
  workingRef.current = working;
  // A double-click replays from just before a word, which can start in the
  // line above; the view stays put until playback reaches the word's line.
  const holdLine = useRef<number | null>(null);
  useEffect(() => {
    if (
      playingLine < 0 ||
      touringRef.current ||
      !isPlaying ||
      workingRef.current ||
      typingInCreator() ||
      Date.now() - scrolledAt.current < 3000
    )
      return;
    if (holdLine.current !== null) {
      if (playingLine < holdLine.current) return;
      holdLine.current = null;
    }
    centre(playingLine);
  }, [playingLine, isPlaying, centre]);
  const toured = useRef(false);
  useEffect(() => {
    if (touring) {
      toured.current = true;
      return;
    }
    if (!toured.current) return;
    toured.current = false;
    centre(isPlaying && playingLine >= 0 ? playingLine : cursor.line);
    // Only the walkthrough closing moves the list here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touring]);

  const issues = useMemo(() => problems(lines), [lines]);
  const { done, total } = progress(lines);
  const entries = useMemo(
    () =>
      track
        ? metadata
          ? withSongwriters(metadata, meta(track))
          : defaultMetadata(meta(track), loadAuthor())
        : (metadata ?? []),
    [metadata, track],
  );
  const ttml = () => (track ? toTtml(lines, meta(track), entries) : "");
  const reviewing = !!reviewSelection && !!onCloseReview && !draftPreview;
  const [pendingReview, setPendingReview] = useState<ReviewOpen>();
  const [reviewEdit, setReviewEdit] = useState<{ id: string; uri: string; baseline: string }>();
  useEffect(() => {
    if (!pendingReview) return;
    if (!reviewing) { setPendingReview(undefined); return; }
    if (playing?.uri !== pendingReview.uri) {
      const timeout = window.setTimeout(() => {
        setPendingReview(undefined);
        notify("Couldn’t open the song in Spotify. Try playing it again.", true);
      }, 12_000);
      return () => window.clearTimeout(timeout);
    }
    if (track?.uri !== pendingReview.uri) {
      setTrack(playing);
      return;
    }
    const { uri } = track;
    let live = true;
    void (async () => {
      const lyrics = parseLocalTtml(pendingReview.ttml);
      const loaded = joinHyphenated(fromLyrics(lyrics));
      if (!loaded.length) throw new Error("No lyric lines found.");
      const song = meta(track);
      const reviewMetadata = defaultMetadata(song);
      if (lyrics.songwriters?.length && !reviewMetadata.some((entry) => entry.key === "songwriters")) {
        reviewMetadata.push({ key: "songwriters", values: lyrics.songwriters });
      }
      const previous = loadDraft(uri);
      if (previous) {
        await addVersion({
          uri, savedAt: Date.now(), lines: previous.lines, text: previous.text, metadata: previous.metadata, appleOriginal: previous.appleOriginal,
        });
      }
      if (!live) return;
      editedFor.current = uri;
      setAppleOriginal(undefined);
      setLines(loaded);
      setText(toText(loaded));
      setMetadata(reviewMetadata);
      setCursor({ line: 0, unit: 0 });
      setTextMode(false);
      setTab("write");
      setReviewEdit({
        id: pendingReview.submission.id, uri, baseline: toTtml(loaded, song, reviewMetadata),
      });
      setPendingReview(undefined);
      notify(previous ? "Submission opened. Your earlier draft is in Saves." : "Submission opened for review.");
    })().catch((error) => {
      if (!live) return;
      setPendingReview(undefined);
      notify(`Couldn’t open the submission: ${String(error)}`, true);
    });
    return () => { live = false; };
  }, [pendingReview, playing, track, reviewing, setLines, notify, window]);
  const reviewPanel = reviewing && reviewSelection && onCloseReview && (
    <ReviewPanel
      selection={reviewSelection}
      playing={playing}
      editing={done && reviewEdit?.uri === track?.uri ? reviewEdit : undefined}
      opening={pendingReview?.submission.id}
      editorTtml={ttml}
      onPlay={(uri) => onPlayer({ command: "play", uri })}
      onOpen={(open) => {
        setPendingReview(open);
        if (playing?.uri !== open.uri) onPlayer({ command: "play", uri: open.uri });
      }}
      onCancelOpen={() => setPendingReview(undefined)}
      onParse={async (text) => parseLocalTtml(text)}
      onSubmitFix={async (text) => {
        if (!track || track.uri !== reviewEdit?.uri) throw new Error("Open the submission in the editor first.");
        const message = await onSubmit(track, text);
        if (message) notify(message);
      }}
      onDecided={(_submission, action, uri) => {
        setReviewEdit(undefined);
        setPendingReview(undefined);
        if (action !== "approve" || !uri) return;
        const trackId = uri.split(":").at(-1)!;
        revalidateLyssnaSong(trackId);
        window.dispatchEvent(new CustomEvent(lyricsChanged, { detail: [trackId] }));
      }}
      notify={notify}
      onClose={onCloseReview}
    />
  );
  const [editingMeta, setEditingMeta] = useState(false);
  const changeMetadata = (next: MetaEntry[]) => {
    setMetadata(next);
    const author = next.filter(
      (entry) =>
        AUTHOR_KEYS.includes(entry.key) &&
        entry.values.some((value) => value.trim()),
    );
    // Clearing one song's fields keeps the author for the next song.
    if (author.length) writeStorage(AUTHOR_KEY, JSON.stringify(author));
  };

  const [exporting, setExporting] = useState(false);
  const download = (format: ExportFormat | "ttml" = "ttml") => {
    if (!track) return;
    setExporting(false);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([format === "ttml" ? ttml() : exportLyrics(format, lines)], {
        type: format === "ttml" ? "application/ttml+xml" : "text/plain",
      }),
    );
    link.download = fileName(meta(track)).replace(/\.ttml$/, `.${format}`);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  };
  const importFile = async (file: File) => {
    if (file.size > 2_000_000) return notify("Lyric file exceeds 2 MB", true);
    const format = formatOf(file.name);
    const source = await file.text();
    try {
      const parsed = (WORD_FORMATS as readonly string[]).includes(format)
        ? parseWordFormat(format as WordFormat, source)
        : fromLyrics(await onParse(file.name, source, track));
      if (!parsed.length)
        return notify(`No lyrics found in ${file.name}.`, true);
      setAppleOriginal(undefined);
      setLines(parsed);
      setText(toText(parsed));
      setCursor({ line: 0, unit: 0 });
      notify(
        `Imported ${parsed.length} line${parsed.length === 1 ? "" : "s"} from ${file.name}. Ctrl+Z undoes it.`,
      );
    } catch (error) {
      notify(`Couldn't read ${file.name}: ${String(error)}`, true);
    }
  };
  // A lyric file dropped anywhere while the creator is open belongs in the
  // creator, not in the song's saved lyrics, where the app sends drops.
  const importRef = useRef(importFile);
  importRef.current = importFile;
  useEffect(() => {
    if (draftPreview) return;
    const carriesFile = (event: DragEvent) =>
      !!event.dataTransfer?.types.includes("Files");
    const over = (event: DragEvent) => {
      if (!carriesFile(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const drop = (event: DragEvent) => {
      if (!carriesFile(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const file = event.dataTransfer?.files[0];
      if (file) void importRef.current(file);
    };
    window.addEventListener("dragover", over, true);
    window.addEventListener("drop", drop, true);
    return () => {
      window.removeEventListener("dragover", over, true);
      window.removeEventListener("drop", drop, true);
    };
  }, [draftPreview]);
  const importPicker = useRef<HTMLInputElement>(null);
  const pickImport = () => importPicker.current?.click();
  const importInput = (
    <input
      ref={importPicker}
      type="file"
      hidden
      accept=".ttml,.xml,.lrc,.qrc,.yrc,.lys,.eslrc"
      aria-label="Lyric file to import"
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void importFile(file);
      }}
    />
  );
  const copy = () =>
    void window.navigator.clipboard.writeText(ttml()).then(
      () => notify("TTML copied."),
      () => notify("Couldn't copy the TTML.", true),
    );
  const apply = () => {
    if (!track || !here) return;
    void onApply(track, fileName(meta(track)), ttml());
  };
  const [submitting, setSubmitting] = useState(false);
  const submittable = !!track?.id && (!track.is_local || !!(here ? localIsrc : track.spotify?.isrc));
  const submit = async () => {
    if (!track || submitting) return;
    setSubmitting(true);
    try {
      const message = await onSubmit(track, ttml(), appleOriginal);
      if (message) notify(message);
    } catch (error) {
      notify(String(error), true);
    } finally {
      setSubmitting(false);
    }
  };

  const [saves, setSaves] = useState<{
    songs: SavedSong[];
    versions: DraftVersion[];
  } | null>(null);
  const [olderSaves, setOlderSaves] = useState(false);
  const openSaves = () => {
    setOlderSaves(false);
    setSaves({ songs: listDrafts(), versions: [] });
    if (track)
      void listVersions(track.uri).then(
        (versions) => setSaves((open) => open && { ...open, versions }),
        () => {},
      );
  };
  const restore = (version: DraftVersion) => {
    setAppleOriginal(version.appleOriginal);
    setLines(version.lines);
    setText(version.text);
    if (version.metadata) setMetadata(version.metadata);
    setCursor({ line: 0, unit: 0 });
    setSaves(null);
    notify(`Restored the save from ${savedLabel(version.savedAt)}.`);
  };
  const forget = (song: SavedSong) => {
    void deleteSaves(song.uri).finally(() =>
      setSaves(
        (open) =>
          open && {
            songs: open.songs.filter((saved) => saved.uri !== song.uri),
            versions: song.uri === track?.uri ? [] : open.versions,
          },
      ),
    );
    if (song.uri === track?.uri) setSavedAt(undefined);
  };
  const savesDialog = saves && (
    <div className="ttml-dialog-backdrop" onClick={() => setSaves(null)}>
      <div
        className="ttml-dialog ttml-saves"
        role="dialog"
        aria-label="TTML saves"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h3>Saves</h3>
          <button onClick={() => setSaves(null)} aria-label="Close saves">
            <X size={16} />
          </button>
        </header>
        <p className="ttml-hint">
          Drafts save on every change. A dated version is kept every 10 minutes,
          whenever you leave a song and when you press {IS_MAC ? "Cmd" : "Ctrl"}
          +S, up to 10 per song.
        </p>
        {track && (
          <section>
            <h4>Versions of {track.name}</h4>
            {saves.versions.length ? (
              <ul>
                {saves.versions
                  .slice(0, olderSaves ? undefined : 2)
                  .map((version) => (
                    <li key={version.id ?? version.savedAt}>
                      <span>
                        <strong>{savedLabel(version.savedAt)}</strong>
                        <small>
                          {version.lines.length} line
                          {version.lines.length === 1 ? "" : "s"}
                        </small>
                      </span>
                      <button onClick={() => restore(version)}>Restore</button>
                    </li>
                  ))}
                {saves.versions.length > 2 && (
                  <li className="ttml-saves-more">
                    <button
                      aria-expanded={olderSaves}
                      onClick={() => setOlderSaves(!olderSaves)}
                    >
                      {olderSaves
                        ? "Hide older versions"
                        : `${saves.versions.length - 2} older version${saves.versions.length === 3 ? "" : "s"}`}
                      <ChevronDown
                        size={15}
                        className={olderSaves ? "open" : ""}
                      />
                    </button>
                  </li>
                )}
              </ul>
            ) : (
              <p className="ttml-hint">No earlier versions yet.</p>
            )}
          </section>
        )}
        <section>
          <h4>Saved songs</h4>
          {saves.songs.length ? (
            <ul>
              {saves.songs.map((saved) => (
                <li
                  key={saved.uri}
                  className={saved.uri === track?.uri ? "current" : ""}
                >
                  <span>
                    <strong>{saved.song?.name ?? saved.uri}</strong>
                    <small>
                      {saved.song &&
                        `${saved.song.artists.map((artist) => artist.name).join(", ")} · `}
                      {saved.savedAt
                        ? `Saved ${savedLabel(saved.savedAt)}`
                        : "Saved before save times were kept"}
                    </small>
                  </span>
                  {saved.uri !== track?.uri && (
                    <button
                      disabled={!saved.song}
                      title={
                        saved.song
                          ? undefined
                          : "Play this song to open its draft"
                      }
                      onClick={() => {
                        if (saved.song) setTrack(saved.song);
                        setSaves(null);
                      }}
                    >
                      Open
                    </button>
                  )}
                  <button
                    className="danger"
                    onClick={() => forget(saved)}
                    aria-label={`Delete saves for ${saved.song?.name ?? saved.uri}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ttml-hint">Nothing saved yet.</p>
          )}
        </section>
      </div>
    </div>
  );

  const speedControl = (showAudioPicker: boolean) => <CreatorSpeed speed={shownSpeed} min={MIN_SPEED} max={MAX_SPEED}
    disabled={!here || (!state.speedEnabled && !replayAvailable)} showAudioPicker={showAudioPicker}
    openAudio={here ? openAudio : undefined} onChange={(value) => slideSpeed(clampSpeed(value))} />;

  if (draftPreview) return playbar?.speed && here ? createPortal(speedControl(false), playbar.speed) : null;

  if (!track)
    return (
      <section className="ttml-creator empty" aria-label="TTML Creator">
        <Wand2 size={32} />
        <h2>TTML Creator</h2>
        <p>Play a song, then come back here to time its lyrics.</p>
        <button onClick={openSaves}>
          <History size={15} />
          Saves
        </button>
        {onClose && <button onClick={onClose}>Back to lyrics</button>}
        {savesDialog}
        {reviewPanel}
      </section>
    );

  return (
    <section className={`ttml-creator${playbar?.wave ? " with-playbar" : ""}`} aria-label="TTML Creator">
      <header className="ttml-head">
        <div className="ttml-song">
          <small>TTML Creator</small>
          <strong title={track.name}>{track.name}</strong>
          <span>{track.artists.map((artist) => artist.name).join(", ")}</span>
        </div>
        {classic && (
          <div className="ttml-tabs" role="tablist">
            {(
              [
                ["write", "Lyrics"],
                ["sync", "Sync"],
                ["preview", "Preview"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={tab === value}
                className={tab === value ? "active" : ""}
                disabled={value !== "write" && !lines.length}
                onClick={() => {
                  setTextMode(false);
                  if (tab === "preview" && value !== "preview") selectPlaying();
                  setTab(value);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="ttml-actions">
          {!barSlot && onClose && <button onClick={onClose} title="Close TTML Creator" aria-label="Close TTML Creator">
            <X size={15} />
            <span className="ttml-label">Close</span>
          </button>}
          <span className="ttml-saved">
            {savedAt ? `Saved ${savedLabel(savedAt)}` : "Not saved yet"}
          </span>
          <button onClick={openSaves} title="Saves and earlier versions" aria-label="Saves">
            <History size={15} />
            <span className="ttml-label">Saves</span>
          </button>
          <button onClick={() => setEditingKeys(true)} title="Controls" aria-label="Controls">
            <Settings size={15} />
            <span className="ttml-label">Controls</span>
          </button>
          <button onClick={() => setEditingMeta(true)} title="Metadata" aria-label="Metadata">
            <Tags size={15} />
            <span className="ttml-label">Metadata</span>
          </button>
          <button onClick={copy} disabled={!done} title="Copy TTML" aria-label="Copy TTML">
            <Copy size={15} />
            <span className="ttml-label">Copy</span>
          </button>
          {geniusButton}
          <button
            onClick={pickImport}
            title="Import lyrics file (TTML, LRC, QRC, YRC, Lyricify Syllable or ESLyric)"
            aria-label="Import lyrics file"
          >
            <Upload size={15} />
            <span className="ttml-label">Import</span>
          </button>
          {importInput}
          <span className="ttml-export">
            <button
              onClick={() => setExporting(!exporting)}
              disabled={!done}
              title="Export lyrics file"
              aria-label="Export lyrics file"
              aria-expanded={exporting}
            >
              <Download size={15} />
              <span className="ttml-label">Export</span>
            </button>
            {exporting && (
              <div className="ttml-meta-menu" role="menu">
                {(["ttml", ...EXPORT_FORMATS] as const).map((format) => (
                  <button
                    key={format}
                    role="menuitem"
                    onClick={() => download(format)}
                  >
                    {FORMAT_NAMES[format]}
                    <code>.{format}</code>
                  </button>
                ))}
              </div>
            )}
          </span>
          <button
            onClick={() => void submit()}
            disabled={!done || !submittable || submitting || resettingSource}
            aria-label="Submit to Lyssna"
            aria-busy={submitting}
            title={
              submittable
                ? "Send these lyrics to Lyssna so everyone gets them"
                : track.is_local ? "A local file needs an ISRC match before it can be submitted" : "Play a Spotify song to submit lyrics"
            }
          >
            <Send size={15} />
            <span className="ttml-label">Submit to Lyssna</span>
          </button>
          <button
            className="primary"
            onClick={apply}
            disabled={!done || !here}
            title={
              here
                ? "Save these lyrics for this song in Lyssna"
                : "Play this song to use the lyrics for it"
            }
          >
            <Save size={15} />
            Use for this song
          </button>
        </div>
      </header>

      {!here && (
        <div className="ttml-banner" role="status">
          <span>
            This draft is for <strong>{track.name}</strong>
            {playing ? (
              <>
                , but <strong>{playing.name}</strong> is playing.
              </>
            ) : (
              "."
            )}{" "}
            Timing needs the draft's song playing.
          </span>
          <button onClick={() => onPlayer({ command: "play", uri: track.uri })}>
            Play {track.name}
          </button>
          {playing && (
            <button onClick={() => setTrack(playing)}>
              Work on {playing.name}
            </button>
          )}
        </div>
      )}

      {(textMode || !lines.length) && (
        <div className="ttml-write">
          {!lines.length && !text.trim() && (
            <div className="ttml-sources" role="group" aria-label="Start from">
              <button onClick={startFromLyrics} disabled={!seedable}>
                <Wand2 size={20} />
                <strong>Current lyrics</strong>
                <small>
                  {seedHint}
                </small>
              </button>
              <button onClick={() => void fromGenius()} disabled={!track || fetchingGenius}>
                <Globe size={20} />
                <strong>
                  Lyrics from Genius
                </strong>
                <small>Load plain lyrics into the text editor</small>
              </button>
            </div>
          )}
          <p className="ttml-hint">
            One lyric line per line. Split a word into syllables with{" "}
            <kbd>|</kbd>, like <code>beau|ti|ful</code>. Wrap a background vocal
            in parentheses. Start a line with <code>v2:</code> for the second
            singer. Add section names on their own lines, such as <code>[Chorus]</code> or{" "}
            <code>[Verse 1: Artist]</code>.
          </p>
          <textarea
            aria-label="Lyrics text"
            value={text}
            spellCheck={false}
            placeholder={
              "[Verse 1]\nFirst line of the song\n(background vocal)\nv2: a line the other singer takes"
            }
            onChange={(event) => {
              editedFor.current = track?.uri;
              setText(event.target.value);
            }}
          />
          <div className="ttml-write-actions">
            {previewToggle}
            {draftActions}
            {(lines.length > 0 || !!text.trim()) && (
              <>
                <button
                  onClick={startFromLyrics}
                  disabled={!seedable}
                  title={seedHint}
                >
                  <Wand2 size={15} />
                  Start from current lyrics
                </button>
              </>
            )}
            <button
              onClick={pickImport}
              title="TTML, LRC, QRC, YRC, Lyricify Syllable or ESLyric"
            >
              <Upload size={15} />
              Import file
            </button>
            <div className="ttml-row">
              {lines.length > 0 && (
                <button onClick={() => setTextMode(false)}>Cancel</button>
              )}
              <button
                className="primary"
                onClick={applyText}
                disabled={!text.trim()}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {previewing && !textMode && (
        <div className="ttml-preview">
          {preview?.lines.length && renderPreview ? (
            <CreatorPreview lyrics={preview} playing={isPlaying} offset={heard} track={track} render={renderPreview} />
          ) : (
            <p className="ttml-hint">Time some words to see them here.</p>
          )}
        </div>
      )}
      {editable && (
        <>
          {showSync && (
            <div className="ttml-transport">
              <button
                className="ttml-play"
                onClick={onToggle}
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? (
                  <Pause size={16} fill="currentColor" />
                ) : (
                  <Play size={16} fill="currentColor" />
                )}
              </button>
              <CreatorTime playing={isPlaying} offset={heard} />
              <label
                className="ttml-offset"
                title="Shift every tap by this much. Negative taps earlier."
              >
                Offset
                <input
                  type="number"
                  step={10}
                  value={offset}
                  aria-label="Tap offset in milliseconds"
                  onChange={(event) => {
                    const value = Math.max(
                      -2000,
                      Math.min(2000, Number(event.target.value) || 0),
                    );
                    setOffset(value);
                    writeStorage(OFFSET_KEY, String(value));
                  }}
                />
                ms
              </label>
              <button
                className={`ttml-roman-toggle${syncRoman ? " active" : ""}`}
                aria-pressed={syncRoman}
                disabled={!lines.some(hasWordRoman)}
                onClick={() => {
                  setSyncRoman(!syncRoman);
                  writeStorage(SYNC_ROMAN_KEY, syncRoman ? null : "1");
                }}
                title={
                  lines.some(hasWordRoman)
                    ? "Show each word's romanization instead of its text"
                    : "Fill in word readings or use Auto romanize first"
                }
              >
                <Languages size={15} />
                Romanization
              </button>
              <span className="ttml-progress">
                {done}/{total} timed
              </span>
              <button
                onClick={undo}
                title={`Undo (${MODIFIER}+Z)`}
                aria-label="Undo"
              >
                <Undo2 size={15} />
                <span className="ttml-label">Undo</span>
              </button>
              <button
                onClick={redo}
                title={IS_MAC ? "Redo (Cmd+Shift+Z)" : "Redo (Ctrl+Y)"}
                aria-label="Redo"
              >
                <Redo2 size={15} />
                <span className="ttml-label">Redo</span>
              </button>
              <button
                onClick={() => setLines(clearAll(lines))}
                disabled={!done}
                title="Clear every timing"
                aria-label="Clear every timing"
              >
                <RotateCcw size={15} />
                <span className="ttml-label">Clear timings</span>
              </button>
              {!reviewing && <button
                onClick={() => void resetToSource()}
                disabled={!here || resettingSource || submitting}
                aria-label={resetLabel}
                aria-busy={resettingSource}
                title={resetLabel === "Already showing source" ? resetLabel : "Replace this draft with the best available lyric source"}
              >
                <FileInput size={15} />
                <span className="ttml-label">{resetLabel}</span>
              </button>}
            </div>
          )}
          {writing && (
            <div className="ttml-write-actions">
              <div className="ttml-row">
                <button
                  onClick={startFromLyrics}
                  disabled={!seedable}
                  title={seedHint}
                >
                  <Wand2 size={15} />
                  Start from current lyrics
                </button>
                {draftActions}
                <button onClick={openText}>
                  <Type size={15} />
                  Edit as text
                </button>
                <button
                  className={wordRoman ? "active" : ""}
                  aria-pressed={wordRoman}
                  onClick={() => {
                    setWordRoman(!wordRoman);
                    writeStorage(WORD_ROMAN_KEY, wordRoman ? null : "1");
                  }}
                  title="Show a reading under each word"
                >
                  Word romanization
                </button>
                <button
                  onClick={() => void autoRomanize()}
                  disabled={romanNote === "Romanizing…"}
                  title="Fill empty word readings for lyrics in any non-Latin script"
                >
                  <Languages size={15} />
                  Auto romanize
                </button>
              </div>
              <button className="primary" onClick={() => setTab("sync")}>
                Continue to Sync
              </button>
            </div>
          )}
          {showEdit && !writing && (
            <div
              className="ttml-edit-bar"
              role="toolbar"
              aria-label="Edit lyrics"
            >
              <label className="ttml-field ttml-field-word">
                <span>
                  Word <kbd>{IS_MAC ? "⌘E" : "F2"}</kbd>
                  {!IS_MAC && <kbd>Ctrl+E</kbd>}
                </span>
                <input
                  ref={wordField}
                  key={`word:${cursor.line}:${cursor.unit}:${selectedUnit?.text ?? ""}`}
                  aria-label="Selected word"
                  defaultValue={selectedUnit?.text ?? ""}
                  placeholder="No word selected"
                  disabled={!selectedUnit}
                  spellCheck={false}
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={(event) =>
                    selectedUnit &&
                    event.target.value !== selectedUnit.text &&
                    commitWord(cursor, event.target.value)
                  }
                  onKeyDown={leaveField}
                />
              </label>
              <label className="ttml-field">
                <span>Reading</span>
                <input
                  key={`reading:${cursor.line}:${cursor.unit}:${selectedUnit?.roman ?? ""}`}
                  aria-label="Reading of the selected word"
                  defaultValue={selectedUnit?.roman ?? ""}
                  placeholder={selectedUnit && /[^\p{Script=Latin}\P{L}]/u.test(selectedUnit.text) ? "e.g. i|no|chi" : "–"}
                  title="Use | between pieces of a reading to time them separately"
                  disabled={!selectedUnit}
                  spellCheck={false}
                  onBlur={(event) =>
                    selectedUnit &&
                    event.target.value !== (selectedUnit.roman ?? "") &&
                    setLines(setUnitRoman(lines, cursor, event.target.value))
                  }
                  onKeyDown={leaveField}
                />
              </label>
              {(["translation", "romanization"] as const).map((key) => (
                <label key={key} className="ttml-field">
                  <span>
                    {key === "translation"
                      ? "Translation"
                      : "Line romanization"}
                  </span>
                  <input
                    key={`${key}:${cursor.line}:${selectedLine?.[key] ?? ""}`}
                    aria-label={`${key === "translation" ? "Translation" : "Romanization"} of line ${cursor.line + 1}`}
                    defaultValue={selectedLine?.[key] ?? ""}
                    placeholder="None"
                    disabled={!selectedLine}
                    spellCheck={false}
                    onBlur={(event) =>
                      selectedLine &&
                      event.target.value.trim() !== (selectedLine[key] ?? "") &&
                      setLines(
                        setLineText(
                          lines,
                          cursor.line,
                          key,
                          event.target.value.trim(),
                        ),
                      )
                    }
                    onKeyDown={leaveField}
                  />
                </label>
              ))}
              <span className="ttml-edit-tools">
                {previewToggle}
                {draftActions}
                <button
                  onClick={startFromLyrics}
                  disabled={!seedable}
                  title={seedHint}
                >
                  <Wand2 size={15} />
                  Start from current lyrics
                </button>
                <button onClick={openText}>
                  <Type size={15} />
                  Edit as text
                </button>
                <button
                  onClick={() => void autoRomanize()}
                  disabled={romanNote === "Romanizing…"}
                  title="Fill empty word readings for lyrics in any non-Latin script"
                >
                  <Languages size={15} />
                  Auto romanize
                </button>
              </span>
            </div>
          )}
          {romanNote && (
            <p className="ttml-hint" role="status">
              {romanNote}
            </p>
          )}
          {pickBar}
          <div
            className="ttml-lines"
            ref={list}
            onClick={(event) => {
              if (
                (event.target as Element).closest(
                  ".ttml-unit, .ttml-chip, .ttml-space",
                )
              )
                return;
              setGroup([]);
              setSpaces([]);
            }}
            onDragEnd={endDrag}
            onDragOverCapture={(event) => drag && scrollWhileDragging(event)}
            onWheel={() => {
              scrolledAt.current = Date.now();
              cancelAnimationFrame(glide.current);
            }}
            onTouchMove={() => {
              scrolledAt.current = Date.now();
              cancelAnimationFrame(glide.current);
            }}
          >
            {lines.map((line, lineIndex) => {
              const hasSplitReadings = !syncRoman && line.units.some(unit => romanParts(unit).length > 1);
              const adder = (
                <input
                  className="ttml-chip-add"
                  aria-label={`Add words to line ${lineIndex + 1}`}
                  placeholder="Type word here"
                  spellCheck={false}
                  onFocus={() =>
                    setCursor((at) =>
                      at.line === lineIndex ? at : { line: lineIndex, unit: 0 },
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Escape") event.currentTarget.blur();
                    const box = event.currentTarget;
                    if (
                      !box.value &&
                      event.key === "Backspace" &&
                      !line.units.length &&
                      lines.length > 1
                    ) {
                      event.preventDefault();
                      const next = removeLine(lines, lineIndex);
                      setLines(next);
                      setCursor(
                        clampCursor(next, {
                          line: Math.max(0, lineIndex - 1),
                          unit: 0,
                        }),
                      );
                      return;
                    }
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    event.stopPropagation();
                    const next = appendWords(
                      lines,
                      lineIndex,
                      event.currentTarget.value,
                    );
                    event.currentTarget.value = "";
                    if (next !== lines) setLines(next);
                  }}
                />
              );
              return (
                <Fragment key={lineIndex}>
                {line.part && <button type="button" className="ttml-part"
                  title="Edit section. Right-click for section actions."
                  onClick={() => editSection(lineIndex)} onContextMenu={(event) => {
                    event.preventDefault();
                    setMenu({ x: event.clientX, y: event.clientY, at: { line: lineIndex, unit: 0 }, kind: "section" });
                  }}>
                  {line.singer ? `${line.part} - ${line.singer}` : line.part}
                </button>}
                <div
                  data-line={lineIndex}
                  tabIndex={-1}
                  {...pickProps(lineIndex)}
                  onContextMenu={(event) => openLineMenu(event, lineIndex)}
                  className={`ttml-card ttml-line${VOICE_CLASS[lineVoice(lines, lineIndex)] ?? ""}${line.background ? " background" : ""}${line.opposite ? " opposite" : ""}${cursor.line === lineIndex ? " current" : ""}${line.units.length ? "" : " empty"}${playingLine === lineIndex || liveWords.singing.has(lineIndex) ? " playing" : ""}${picked.has(lineIndex) ? " picked" : ""}${drag?.kind === "line" && drag.line === lineIndex ? " dragging" : ""}${dropClass(`line:${lineIndex}`)}`}
                  onClick={(event) => {
                    const target = event.target as Element;
                    if (target.closest("button, input, textarea")) return;
                    event.currentTarget.focus({ preventScroll: true });
                    if (cursor.line !== lineIndex) {
                      clickedLine.current = true;
                      setCursor(
                        clampCursor(lines, { line: lineIndex, unit: 0 }),
                      );
                    }
                    setGroup([]);
                    setSpaces([]);
                    pickedFrom.current = lineIndex;
                    setPicked(new Set([lineIndex]));
                  }}
                  onPointerDown={(event) => {
                    event.currentTarget.draggable = !(
                      event.target as Element
                    ).closest("button, input");
                  }}
                  onDragStart={(event) =>
                    event.target === event.currentTarget &&
                    startDrag(event, { kind: "line", line: lineIndex })
                  }
                  onDragOver={(event) => {
                    if (drag?.kind === "line")
                      over(
                        event,
                        `line:${lineIndex}:${firstHalf(event, true) ? "before" : "after"}`,
                      );
                    else if (drag?.kind === "word")
                      over(event, `line:${lineIndex}:end`);
                  }}
                  onDrop={(event) => {
                    if (drag?.kind === "line")
                      land(
                        event,
                        moveLine(
                          lines,
                          drag.line,
                          firstHalf(event, true) ? lineIndex : lineIndex + 1,
                        ),
                      );
                    else if (drag?.kind === "word")
                      land(
                        event,
                        moveDragged(drag, {
                          line: lineIndex,
                          unit: line.units.length,
                        }),
                      );
                  }}
                >
                  <span className="ttml-card-number" title="Select line, then press Delete">{lineIndex + 1}</span>
                  {writing ? (
                    <div className="ttml-card-body">
                      <div className="ttml-chips">
                        {line.units.map((unit, unitIndex) => {
                          const at = { line: lineIndex, unit: unitIndex };
                          const editing =
                            inline?.line === lineIndex &&
                            inline.unit === unitIndex;
                          const chosen =
                            (cursor.line === lineIndex &&
                              cursor.unit === unitIndex &&
                              !spaces.length) ||
                            inGroup(at);
                          return (
                            <Fragment key={unitIndex}>
                              {unitIndex > 0 && !unit.joined && (
                                <button
                                  className={`ttml-space${isSpace(at) ? " chosen" : ""}${dropClass(`gap:${lineIndex}:${unitIndex}`)}`}
                                  draggable
                                  onClick={(event) => pickSpace(event, at)}
                                  onDragStart={(event) => {
                                    // A picked space drags the picked words with it.
                                    const words = pickedWords();
                                    if (isSpace(at) && words.length)
                                      startDrag(event, {
                                        kind: "word",
                                        at: words[0],
                                        ...(words.length > 1 && {
                                          group: words,
                                        }),
                                      });
                                    else
                                      startDrag(event, { kind: "space", at });
                                  }}
                                  onDragOver={(event) =>
                                    drag?.kind === "word" &&
                                    over(
                                      event,
                                      `gap:${lineIndex}:${unitIndex}:word`,
                                    )
                                  }
                                  onDrop={(event) =>
                                    drag?.kind === "word" &&
                                    land(event, moveDragged(drag, at))
                                  }
                                >
                                  Space
                                </button>
                              )}
                              <span
                                className={
                                  wordRoman
                                    ? "ttml-chip-stack"
                                    : "ttml-chip-plain"
                                }
                              >
                                {editing ? (
                                  <input
                                    className="ttml-chip-edit"
                                    aria-label={`Edit ${unit.text}`}
                                    autoFocus
                                    defaultValue={unit.text}
                                    size={Math.max(2, unit.text.length + 1)}
                                    spellCheck={false}
                                    onFocus={(event) =>
                                      event.currentTarget.select()
                                    }
                                    onInput={(event) => {
                                      const box = event.currentTarget;
                                      box.size = Math.max(
                                        2,
                                        box.value.length + 1,
                                      );
                                    }}
                                    onBlur={(event) => {
                                      const value =
                                        event.currentTarget.value.trim();
                                      setInline(null);
                                      if (value !== unit.text)
                                        commitWord(at, value);
                                    }}
                                    onKeyDown={(event) => {
                                      event.stopPropagation();
                                      if (event.key === "Escape") {
                                        event.preventDefault();
                                        event.currentTarget.value = unit.text;
                                        event.currentTarget.blur();
                                      } else if (event.key === "Enter") {
                                        event.preventDefault();
                                        event.currentTarget.blur();
                                      }
                                    }}
                                  />
                                ) : (
                                  <button
                                    className={`ttml-chip${unit.joined ? " joined" : ""}${chosen ? " chosen" : ""}${drag?.kind === "word" && ((drag.at.line === lineIndex && drag.at.unit === unitIndex) || (drag.group && inGroup(at))) ? " dragging" : ""}${dropClass(`unit:${lineIndex}:${unitIndex}`)}`}
                                    title={
                                      unit.joined
                                        ? "Syllable. Double-click to edit; right-click to make it its own word."
                                        : "Double-click to edit; drag to move"
                                    }
                                    draggable
                                    onDragStart={(event) =>
                                      dragWords(event, at)
                                    }
                                    onDragOver={(event) => {
                                      if (drag?.kind === "word")
                                        over(
                                          event,
                                          `unit:${lineIndex}:${unitIndex}:${firstHalf(event, false) ? "before" : "after"}`,
                                        );
                                      else if (
                                        drag?.kind === "space" &&
                                        unit.joined &&
                                        drag.at.line === lineIndex
                                      )
                                        over(
                                          event,
                                          `unit:${lineIndex}:${unitIndex}:space`,
                                        );
                                    }}
                                    onDrop={(event) => {
                                      if (drag?.kind === "word") {
                                        const word = wordBounds(
                                          line.units,
                                          unitIndex,
                                        );
                                        land(
                                          event,
                                          moveDragged(drag, {
                                            line: lineIndex,
                                            unit: firstHalf(event, false)
                                              ? word.start
                                              : word.end,
                                          }),
                                        );
                                      } else if (
                                        drag?.kind === "space" &&
                                        unit.joined
                                      )
                                        land(
                                          event,
                                          moveSpace(lines, drag.at, at),
                                        );
                                    }}
                                    onClick={(event) => {
                                      event.currentTarget.focus({ preventScroll: true });
                                      if (
                                        event.shiftKey ||
                                        event.ctrlKey ||
                                        event.metaKey
                                      )
                                        return pickWord(at, event.shiftKey);
                                      setGroup([]);
                                      setSpaces([]);
                                      setPicked(new Set());
                                      setCursor(at);
                                    }}
                                    onDoubleClick={() => {
                                      setCursor(at);
                                      setInline(at);
                                    }}
                                    onContextMenu={(event) =>
                                      openMenu(event, at)
                                    }
                                  >
                                    {unit.text}
                                  </button>
                                )}
                                {wordRoman && (
                                  <input
                                    className="ttml-roman"
                                    key={unit.roman ?? ""}
                                    aria-label={`Romanization of ${unit.text}`}
                                    defaultValue={unit.roman ?? ""}
                                    placeholder="–"
                                    spellCheck={false}
                                    onBlur={(event) =>
                                      event.target.value !==
                                        (unit.roman ?? "") &&
                                      setLines(
                                        setUnitRoman(
                                          lines,
                                          at,
                                          event.target.value,
                                        ),
                                      )
                                    }
                                    onKeyDown={(event) =>
                                      event.key === "Enter" &&
                                      event.currentTarget.blur()
                                    }
                                  />
                                )}
                              </span>
                            </Fragment>
                          );
                        })}
                        {line.spaceAfter && (
                          <button
                            className={`ttml-space${isSpace({ line: lineIndex, unit: line.units.length }) ? " chosen" : ""}`}
                            onClick={(event) =>
                              pickSpace(event, {
                                line: lineIndex,
                                unit: line.units.length,
                              })
                            }
                          >
                            Space
                          </button>
                        )}
                        {adder}
                      </div>
                      {(["translation", "romanization"] as const).map((key) => (
                        <label key={key} className="ttml-card-extra">
                          {key === "translation"
                            ? "Translation:"
                            : "Romanization:"}
                          <input
                            key={line[key] ?? ""}
                            defaultValue={line[key] ?? ""}
                            aria-label={`${key === "translation" ? "Translation" : "Romanization"} of line ${lineIndex + 1}`}
                            placeholder="None"
                            spellCheck={false}
                            onBlur={(event) =>
                              event.target.value.trim() !== (line[key] ?? "") &&
                              setLines(
                                setLineText(
                                  lines,
                                  lineIndex,
                                  key,
                                  event.target.value.trim(),
                                ),
                              )
                            }
                            onKeyDown={(event) =>
                              event.key === "Enter" &&
                              event.currentTarget.blur()
                            }
                          />
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="ttml-cells">
                      {line.units.map((unit, unitIndex) => {
                        const at = { line: lineIndex, unit: unitIndex };
                        const selected =
                          cursor.line === lineIndex &&
                          cursor.unit === unitIndex;
                        const editingReading = syncRoman && !!unit.roman;
                        const inputText = editingReading ? unit.roman! : unit.text;
                        const parts = romanParts(unit);
                        const timings = parts.length > 1 ? romanPieces(unit) : [];
                        const reading = parts.length > 1 ? <span className={`ttml-reading-pieces${syncRoman ? " large" : ""}`}>
                          {parts.map((part, index) => {
                            const span = timings[index];
                            const active = (!!span && position >= span.start && position < span.end) ||
                              (selected && (cursor.part ?? 0) === index);
                            return <span key={index} className={active ? "active" : undefined} onClick={(event) => {
                              event.stopPropagation();
                              setCursor({ ...at, part: index });
                            }}>{part}</span>;
                          })}
                        </span> : undefined;
                        const live =
                          (liveWord?.line === lineIndex &&
                            liveWord.unit === unitIndex) ||
                          // The lit word's own line keeps its steadied pick.
                          (liveWord?.line !== lineIndex &&
                            liveWords.live.has(`${lineIndex}:${unitIndex}`));
                        if (
                          inline?.line === lineIndex &&
                          inline.unit === unitIndex
                        )
                          return (
                            <div
                              key={unitIndex}
                              className={`ttml-unit selected editing${unit.joined ? " joined" : ""}${timed(unit) ? " timed" : ""}`}
                            >
                              <TimePill ms={unit.start} />
                              <input
                                className="ttml-inline-word"
                                aria-label={editingReading ? `Edit the reading of ${unit.text}` : `Edit ${unit.text}`}
                                defaultValue={inputText}
                                size={Math.max(2, inputText.length + 1)}
                                spellCheck={false}
                                autoFocus
                                onFocus={(event) =>
                                  event.currentTarget.select()
                                }
                                onInput={(event) => {
                                  const box = event.currentTarget;
                                  box.size = Math.max(2, box.value.length + 1);
                                }}
                                onBlur={(event) => {
                                  const value =
                                    event.currentTarget.value.trim();
                                  setInline(null);
                                  if (value === inputText) return;
                                  if (editingReading) setLines(setUnitRoman(lines, at, value));
                                  else commitWord(at, value);
                                }}
                                onKeyDown={(event) => {
                                  event.stopPropagation();
                                  if (event.key === "Escape") {
                                    event.preventDefault();
                                    event.currentTarget.value = inputText;
                                    event.currentTarget.blur();
                                  } else if (event.key === "Enter") {
                                    event.preventDefault();
                                    event.currentTarget.blur();
                                  }
                                }}
                              />
                              <TimePill ms={unit.end} end />
                            </div>
                          );
                        return (
                          <button
                            key={unitIndex}
                            className={`ttml-unit${unit.joined ? " joined" : ""}${timed(unit) ? " timed" : unit.start !== undefined ? " started" : ""}${selected ? " selected" : ""}${live ? " live" : ""}${inGroup(at) ? " chosen" : ""}${drag?.kind === "word" && ((drag.at.line === lineIndex && drag.at.unit === unitIndex) || (drag.group && inGroup(at))) ? " dragging" : ""}${dropClass(`unit:${lineIndex}:${unitIndex}`)}`}
                            aria-label={unit.text}
                            aria-current={selected || undefined}
                            title={`Double-click to edit, or to replay while playing, right-click for word options, ${IS_MAC ? "Cmd+E" : "F2"} to edit, drag to move`}
                            draggable
                            onDragStart={(event) => dragWords(event, at)}
                            onDragOver={(event) =>
                              drag?.kind === "word" &&
                              over(
                                event,
                                `unit:${lineIndex}:${unitIndex}:${firstHalf(event, false) ? "before" : "after"}`,
                              )
                            }
                            onDrop={(event) => {
                              if (drag?.kind !== "word") return;
                              land(
                                event,
                                moveDragged(drag, {
                                  line: lineIndex,
                                  unit: firstHalf(event, false)
                                    ? unitIndex
                                    : unitIndex + 1,
                                }),
                              );
                            }}
                            onClick={(event) => {
                              event.currentTarget.focus({ preventScroll: true });
                              if (lineIndex !== cursor.line)
                                clickedLine.current = true;
                              if (
                                event.shiftKey ||
                                event.ctrlKey ||
                                event.metaKey
                              )
                                return pickWord(at, event.shiftKey);
                              setGroup([]);
                              setSpaces([]);
                              setPicked(new Set());
                              setCursor(at);
                            }}
                            onDoubleClick={() => {
                              if (!isPlaying) {
                                setCursor(at);
                                setInline(at);
                                return;
                              }
                              if (unit.start === undefined) return;
                              holdLine.current = lineIndex;
                              seek(unit.start - 1000);
                            }}
                            onContextMenu={(event) => openMenu(event, at)}
                          >
                            <TimePill ms={unit.start} />
                            <span
                              className={`ttml-word${WORD_VOICE_CLASS[unitVoice(lines, at)] ?? ""}`}
                              title={
                                syncRoman && unit.roman ? unit.text : undefined
                              }
                            >
                              {syncRoman ? reading ?? parts[0] ?? unit.text : unit.text}
                            </span>
                            {hasSplitReadings && (reading ?? <span className="ttml-reading-pieces" aria-hidden="true" />)}
                            <TimePill ms={unit.end} end />
                          </button>
                        );
                      })}
                      {adder}
                    </div>
                  )}
                  {!writing && (
                    <div className="ttml-line-side">
                      <TimePill ms={lineSpan(line)?.start} />
                      <TimePill
                        ms={
                          line.units.some((unit) => unit.end !== undefined)
                            ? lineSpan(line)?.end
                            : undefined
                        }
                        end
                      />
                    </div>
                  )}
                  <div className="ttml-line-tools">
                    <button
                      className={line.background ? "active" : ""}
                      aria-pressed={line.background}
                      title="Background vocal"
                      onClick={() => flagLine(lineIndex, "background")}
                    >
                      BG
                    </button>
                    <button
                      className={line.opposite ? "active" : ""}
                      aria-pressed={line.opposite}
                      title="Second singer"
                      onClick={() => flagLine(lineIndex, "opposite")}
                    >
                      v2
                    </button>
                    <button
                      title="Delete line"
                      aria-label="Delete line"
                      onClick={() => {
                        const next = removeLine(lines, lineIndex);
                        setLines(next);
                        setCursor((at) => clampCursor(next, at));
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                    <button
                      title="Add line below"
                      aria-label="Add line below"
                      onClick={() => addBlankLine(lineIndex)}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
                </Fragment>
              );
            })}
          </div>
          {issues.length > 0 && (
            <p className="ttml-issues">{issues.join(" ")}</p>
          )}
        </>
      )}
      {menu && (
        <WordMenu
          x={menu.x}
          y={menu.y}
          groups={menu.kind === "section" ? [[
            { label: "Edit section", run: () => editSection(menu.at.line) },
            { label: "Remove section", run: () => setLines(setSection(lines, menu.at.line)) },
          ]] : menu.kind === "line" ? lineMenuGroups(menu.at.line) : menuGroups(menu.at)}
          label={menu.kind === "section" ? "Section actions" : menu.kind === "line" ? "Line actions" : "Word actions"}
          onClose={() => setMenu(null)}
        />
      )}
      {reviewingGenius && reviewedChanges && <GeniusReview
        changes={{ ...reviewedChanges, differs: reviewedChanges.differs.filter(item => !ignoredGenius.includes(ignoreKey(item))) }}
        onIgnore={(item) => {
          const next = [...ignoredGenius, ignoreKey(item)].slice(-500);
          setIgnoredGenius(next);
          writeStorage(IGNORED_GENIUS, JSON.stringify(next));
        }}
        onGo={(line) => { setCursor({ line, unit: 0 }); centre(line); }}
        onKeep={() => { setGeniusReview(undefined); scrolledAt.current = Date.now(); }}
        canUndo={lines === reviewingGenius.applied}
        onUndo={() => { undo(); setGeniusReview(undefined); scrolledAt.current = Date.now(); }}
        onMakeLeads={(chosen, background) => setLines(lines.map((line, index) => chosen.includes(index) ? { ...line, background } : line))}
        onFix={(at, genius) => {
          const fixed = fixFromGenius(lines[at], genius);
          if (fixed) setLines(lines.map((line, index) => index === at ? fixed : line));
        }}
        onAddMissing={() => setLines(addMissing(lines, reviewedChanges.missing))}
      />}
      {splittingReading && lines[splittingReading.line]?.units[splittingReading.unit]?.roman && <ReadingSplitDialog
        word={lines[splittingReading.line].units[splittingReading.unit].text}
        reading={lines[splittingReading.line].units[splittingReading.unit].roman!}
        matches={sameReadings(lines, splittingReading)}
        onClose={() => setSplittingReading(null)}
        onConfirm={(reading, everywhere) => {
          const updated = setUnitRoman(lines, splittingReading, reading);
          setLines(everywhere ? splitReadings(updated, reading) : updated);
          setSplittingReading(null);
        }}
      />}
      {sectionEdit && <div className="ttml-dialog-backdrop" onClick={() => setSectionEdit(undefined)}>
        <form className="ttml-dialog" aria-label="Edit song section" onClick={(event) => event.stopPropagation()} onSubmit={(event) => {
          event.preventDefault();
          setLines(setSectionSinger(setSection(lines, sectionEdit.line, sectionEdit.part), sectionEdit.line, sectionEdit.singer));
          setSectionEdit(undefined);
        }}>
          <h3>{lines[sectionEdit.line]?.part ? "Edit section" : "Start section here"}</h3>
          <label className="ttml-field">Section name<input autoFocus required list={sectionNames} value={sectionEdit.part}
            onChange={(event) => setSectionEdit({ ...sectionEdit, part: event.currentTarget.value })} /></label>
          <datalist id={sectionNames}>{SECTION_NAMES.map(name => <option key={name} value={name} />)}</datalist>
          <label className="ttml-field">Singers<input value={sectionEdit.singer}
            onChange={(event) => setSectionEdit({ ...sectionEdit, singer: event.currentTarget.value })} /></label>
          <div className="ttml-dialog-row end"><button type="button" onClick={() => setSectionEdit(undefined)}>Cancel</button>
            <button type="submit" className="primary">Save section</button></div>
        </form>
      </div>}
      {splitting && lines[splitting.line]?.units[splitting.unit] && (
        <SplitDialog
          word={lines[splitting.line].units[splitting.unit].text}
          learned={learned}
          onClose={() => setSplitting(null)}
          onConfirm={(choice) => confirmSplit(splitting, choice)}
        />
      )}
      {replacing && lines[replacing.line]?.units[replacing.unit] && (
        <ReplaceDialog
          word={lines[replacing.line].units[replacing.unit].text}
          onClose={() => setReplacing(null)}
          onConfirm={(choice) => confirmReplace(replacing, choice)}
        />
      )}
      {savesDialog}
      {touring && editable && <TtmlTour keys={keys} barSlot={barSlot} onClose={endTour} />}
      {editingKeys && (
        <KeysDialog
          onTour={() => {
            setEditingKeys(false);
            setTextMode(false);
            setTab("write");
            setTouring(true);
          }}
          classic={classic}
          onClassic={(on) => {
            setClassic(on);
            setTab("write");
            writeStorage(CLASSIC_KEY, on ? "1" : null);
          }}
          keys={keys}
          onChange={changeKeys}
          onClose={() => setEditingKeys(false)}
        />
      )}
      {editingMeta && (
        <MetadataDialog
          entries={entries}
          onChange={changeMetadata}
          onReset={() => setMetadata(undefined)}
          onClose={() => setEditingMeta(false)}
        />
      )}
      {barSlot && spectrogram && (
        <TtmlSpectrogram
          key={track.uri}
          id={spectrogramId}
          uri={track.uri}
          duration={track.duration_ms}
          offset={heard}
          playing={isPlaying}
          lines={lines}
          cursor={cursor}
          picked={picked}
          onSeek={seek}
          onLines={setLines}
          onCursor={setCursor}
          onPlayUnit={playUnit}
          canCapture={here && !playingFullRecording}
        />
      )}
      {barSlot && createPortal(
        <TtmlBar playing={isPlaying} offset={heard} duration={track.duration_ms}
          peaks={peaks?.uri === track.uri ? peaks.values : null} spans={barSpans} onSeek={seek}
          track={playing?.uri === track.uri ? playing : track} recording={here ? recording : undefined} />, barSlot)}
      {barSlot && createPortal(speedControl(true), playbar?.speed ?? barSlot)}
      {playbar?.play && here && state.speedEnabled && createPortal(
        <CreatorPlay playing={isPlaying} onToggle={onToggle} />, playbar.play)}
      {barSlot && createPortal(
        <CreatorSpectrogramToggle open={spectrogram} id={spectrogramId}
          onToggle={() => showSpectrogram(!spectrogram)} />, playbar?.spectrogram ?? barSlot)}
      {reviewPanel}
    </section>
  );
}
