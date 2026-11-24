import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BulkTtml } from "./bulk-ttml";
import type { Track, TtmlTrack } from "../host";
import type { LoadMode } from "../local-lyrics";
import { confirmLocalTrackIsrc, matchLocalTrackIsrc, suggestLocalTrack, type LocalTrackSuggestion } from "../local-track-isrc";
import { clock } from "../playback";
import type { Settings } from "../settings";
import { accountChanged, hasLyssnaSession, readLyssnaProfile } from "../lyssna-account";
import { publishingRoles } from "../lyssna-submission";
import { importError, type BulkFile, type BulkLyric } from "../ttml-import";
import type { TransferLyrics } from "./transfer-format";
import { spotifySongKey } from "../spotify-song";
import {
  BookOpen,
  Files,
  ChevronLeft,
  Database,
  Download,
  Music2,
  Play,
  RotateCcw,
  Search,
  Send,
  Trash2,
  Upload,
  X,
} from "lucide-react";

const TITLES = {
  load: "Load TTML",
  database: "TTML Database",
  bulk: "Bulk Load",
} as const;

const MODES: { mode: LoadMode; title: string; detail: string }[] = [
  {
    mode: "persistent",
    title: "Persistent Load",
    detail: "Saved on this computer, survives restarts",
  },
  {
    mode: "temporary",
    title: "Temporary Load",
    detail: "Applied only to the current song until lyrics reload",
  },
  {
    mode: "session",
    title: "Session Load",
    detail: "Used for this song until Lyssna restarts",
  },
];

function RecordingMatch({ track, duration, isrc, busy, act }: {
  track: Track;
  duration: number;
  isrc?: string;
  busy: boolean;
  act: (action: () => Promise<void>) => void;
}) {
  const [input, setInput] = useState("");
  const [unverifiedIsrc, setUnverifiedIsrc] = useState<string>();
  const [suggestion, setSuggestion] = useState<LocalTrackSuggestion | null>();
  const [editing, setEditing] = useState(false);
  const showForm = !isrc || editing;
  useEffect(() => {
    if (!showForm) return;
    let active = true;
    void suggestLocalTrack(track, duration).catch(() => undefined).then(result => {
      if (active) setSuggestion(result ?? null);
    });
    return () => { active = false; };
  }, [track, duration, showForm]);
  function finishMatch() {
    setEditing(false);
    setInput("");
    setUnverifiedIsrc(undefined);
  }
  const confirm = (code: string) => act(async () => {
    confirmLocalTrackIsrc(track, duration, code);
    finishMatch();
  });
  if (!showForm) return <section className="load-ttml-match" aria-label="Local recording match">
    <div className="load-ttml-match-result">
      <div><strong>Local recording matched</strong><small>{isrc}</small></div>
      {!track.isrc && <div className="load-ttml-actions">
        <button type="button" disabled={busy} onClick={() => setEditing(true)}>Change match</button>
      </div>}
    </div>
  </section>;
  return <section className="load-ttml-match" aria-label="Match local recording">
    <strong>Match local recording</strong>
    <form className="load-ttml-isrc" onSubmit={event => {
      event.preventDefault();
      if (busy || !input.trim()) return;
      act(async () => {
        const result = await matchLocalTrackIsrc(track, duration, input);
        if (result) setUnverifiedIsrc(result.unverifiedIsrc);
        else finishMatch();
      });
    }}>
      <label className="load-ttml-search">
        <Search size={14} aria-hidden="true" />
        <input aria-label="ISRC or Spotify track link" placeholder="ISRC or Spotify track link" value={input}
          maxLength={300} disabled={busy} onChange={event => {
            setInput(event.currentTarget.value);
            setUnverifiedIsrc(undefined);
          }} />
      </label>
      <div className="load-ttml-actions">
        <button type="submit" disabled={busy || !input.trim()}>Find match</button>
        {isrc && <button type="button" disabled={busy} onClick={finishMatch}>Cancel</button>}
      </div>
    </form>
    {unverifiedIsrc && <div className="load-ttml-match-result">
      <div><strong>{unverifiedIsrc}</strong><small>The catalogue couldn’t verify this code. Use it if it belongs to this recording.</small></div>
      <div className="load-ttml-actions">
        <button type="button" disabled={busy} onClick={() => confirm(unverifiedIsrc)}>Use entered ISRC</button>
      </div>
    </div>}
    {suggestion ? <div className="load-ttml-match-result">
      <div>
        <small>Suggested · Check the recording before using this match</small>
        <strong>{suggestion.title}</strong>
        <small>{[suggestion.artists.join(", "), suggestion.album, clock(suggestion.duration), suggestion.isrc].filter(Boolean).join(" · ")}</small>
      </div>
      <div className="load-ttml-actions">
        <button type="button" disabled={busy} onClick={() => confirm(suggestion.isrc)}>Use suggestion</button>
      </div>
    </div> : <small role="status">{suggestion === undefined ? "Finding a suggested recording…" : "No suggested recording found."}</small>}
  </section>;
}

/**
 * Spicy Lyrics' "Load TTML" window (iPixelGalaxy/spicy-lyrics,
 * UploadTTMLModal and LyricsManager, AGPL-3.0), reimplemented: three ways to
 * load a lyric file, a reset back to provider lyrics, and the saved files.
 */
export function LoadTtml({
  song,
  localRecording,
  reviewer,
  onReviewer,
  onLoad,
  onReset,
  onGuide,
  listSaved,
  deleteSaved,
  onPlay,
  onDownload,
  onClose,
  onBulk,
  searchSongs,
  attachSong,
  onSubmit,
  glass,
  style,
}: {
  onBulk: (files: BulkFile[], signal: AbortSignal) => Promise<BulkLyric[]>;
  searchSongs: (query: string) => Promise<TtmlTrack[]>;
  attachSong: (file: BulkFile, songs: TtmlTrack[]) => Promise<void>;
  onSubmit: (file: File) => Promise<void>;
  song?: string;
  localRecording?: { track: Track; duration: number; isrc?: string };
  reviewer: Settings["ttml_reviewer"];
  onReviewer: (mode: Settings["ttml_reviewer"]) => void;
  onLoad: (file: File, mode: LoadMode) => Promise<void>;
  onReset: () => Promise<void>;
  onGuide: () => void;
  listSaved: () => Promise<TransferLyrics[]>;
  deleteSaved: (uri: string) => Promise<void>;
  onPlay: (uri: string) => Promise<void>;
  onDownload: (item: TransferLyrics) => void;
  onClose: () => void;
  glass: boolean;
  style: CSSProperties;
}) {
  const [view, setView] = useState<"load" | "database" | "bulk">("load");
  const [bulkFiles, setBulkFiles] = useState<BulkFile[]>([]);
  const [bulkResults, setBulkResults] = useState<BulkLyric[] | null>(null);
  const many = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const signInRequired = "Sign in to Lyssna in Settings to submit lyrics";
  const [submitBlock, setSubmitBlock] = useState<string | null>(() => hasLyssnaSession() ? "Checking your Lyssna account…" : signInRequired);
  const submitBlocked = localRecording && !localRecording.isrc ? "A local file needs an ISRC match before it can be submitted" :
    submitBlock ?? (song ? null : "Play the song you want to submit lyrics for");
  const [saved, setSaved] = useState<TransferLyrics[] | null>(null);
  const [error, setError] = useState("");
  const batch = useRef<AbortController>(null);
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const words = filter.trim().toLocaleLowerCase();
    return (saved ?? []).filter(
      (item) =>
        !words ||
        `${item.name} ${item.artists}`.toLocaleLowerCase().includes(words),
    );
  }, [saved, filter]);
  const input = useRef<HTMLInputElement>(null);
  const submitInput = useRef<HTMLInputElement>(null);
  const pendingSubmit = useRef<(file: File) => Promise<void>>(undefined);
  const pending = useRef<(file: File) => Promise<void>>(undefined);
  useEffect(() => {
    let active = true;
    const updateSession = () => { if (!hasLyssnaSession()) setSubmitBlock(signInRequired); };
    window.addEventListener(accountChanged, updateSession);
    if (hasLyssnaSession()) void readLyssnaProfile().catch(() => undefined).then((profile) => {
      if (!active) return;
      if (!hasLyssnaSession()) setSubmitBlock(signInRequired);
      else if (!profile?.role) setSubmitBlock("Couldn’t check your Lyssna account");
      else setSubmitBlock(publishingRoles.includes(profile.role) ? null : "Only Uploaders and above can submit from here");
    });
    return () => { active = false; window.removeEventListener(accountChanged, updateSession); };
  }, []);
  useEffect(() => {
    if (view !== "database") return;
    let live = true;
    void listSaved().then((items) => live && setSaved(items), () => {
      if (live) { setSaved([]); setError("Couldn’t read saved lyrics."); }
    });
    return () => {
      live = false;
    };
  }, [view, listSaved]);
  useEffect(() => () => batch.current?.abort(), []);
  const act = (action: () => Promise<void>) => {
    setError("");
    setBusy(true);
    void action().catch((why) => setError(importError(why))).finally(() => setBusy(false));
  };
  const back = () => {
    batch.current?.abort();
    setError("");
    setView("load");
  };
  const pick = (mode: LoadMode) => {
    if (busy) return;
    pending.current = (file) => onLoad(file, mode);
    if (input.current) {
      input.current.value = "";
      input.current.click();
    }
  };
  return (
    <div className={`modal-backdrop load-ttml-backdrop${glass ? " liquid-glass" : ""}`} style={style} onClick={onClose}>
      <section
        className="dialog load-ttml"
        role="dialog"
        aria-modal="true"
        aria-label={TITLES[view]}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="load-ttml-head">
          <h2>{TITLES[view]}</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose} autoFocus>
            <X size={20} />
          </button>
        </header>
        {error && <p className="load-ttml-error" role="alert">{error}</p>}
        {view === "load" ? (
          <div className="load-ttml-body">
            <div className="load-ttml-row">
              <p>For: {song ?? "No song playing"}</p>
              <div className="load-ttml-actions">
                <button onClick={onGuide} disabled={busy}>
                  <BookOpen size={14} />
                  Guide
                </button>
                <button onClick={() => act(onReset)} disabled={busy || !song}>
                  <RotateCcw size={14} />
                  Reset TTML
                </button>
                <button
                  title="Load many lyric files at once, each saved for its own song"
                  onClick={() => {
                    if (busy || !many.current) return;
                    many.current.value = "";
                    many.current.click();
                  }}
                  disabled={busy}
                >
                  <Files size={14} />
                  Bulk Load
                </button>
                <button onClick={() => setView("database")} disabled={busy}>
                  <Database size={14} />
                  TTML Database
                </button>
              </div>
            </div>
            <label className="load-ttml-reviewer">
              <span>
                <strong>TTML Reviewer</strong>
                <small>Use default lyric timing and rendering while reviewing.</small>
              </span>
              <select className="settings-select" aria-label="TTML Reviewer" value={reviewer} disabled={busy}
                onChange={(event) => onReviewer(event.currentTarget.value as Settings["ttml_reviewer"])}>
                <option value="off">Off</option>
                <option value="temporary">Apply on Temp</option>
                <option value="always">Always Apply</option>
              </select>
            </label>
            <input
              ref={input}
              type="file"
              accept=".ttml,.xml,.lrc"
              hidden
              aria-label="Lyric file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                const load = pending.current;
                if (file && load) act(() => load(file));
              }}
            />
            <div className="load-ttml-modes">
              {MODES.map(({ mode, title, detail }) => (
                <button
                  key={mode}
                  className="load-ttml-mode"
                  onClick={() => pick(mode)}
                  disabled={busy || !song}
                >
                  <span className="load-ttml-icon">
                    <Upload size={15} />
                  </span>
                  <span>
                    <strong>{title}</strong>
                    <small>{detail}</small>
                  </span>
                </button>
              ))}
              <button className="load-ttml-mode load-ttml-submit" title={submitBlocked ?? undefined} disabled={busy || !!submitBlocked}
                onClick={() => {
                  if (!submitInput.current || busy || submitBlocked) return;
                  pendingSubmit.current = onSubmit;
                  submitInput.current.value = "";
                  submitInput.current.click();
                }}>
                <span className="load-ttml-icon"><Send size={15} /></span>
                <span><strong>Submit to Lyssna</strong><small>{submitBlocked ?? "Upload a TTML for this song to Lyssna for everyone"}</small></span>
              </button>
            </div>
            {localRecording && <RecordingMatch key={localRecording.track.id}
              track={localRecording.track} duration={localRecording.duration} isrc={localRecording.isrc} busy={busy} act={act} />}
            <input ref={submitInput} type="file" accept=".ttml,.xml" hidden aria-label="TTML file to submit"
              onChange={(event) => {
                const file = event.target.files?.[0];
                const submit = pendingSubmit.current;
                pendingSubmit.current = undefined;
                if (file && submit) act(() => submit(file));
              }} />
            <input
              ref={many}
              type="file"
              accept=".ttml,.xml,.lrc"
              multiple
              hidden
              aria-label="Lyric files"
              onChange={(event) => {
                const picked = Array.from(event.target.files ?? []);
                if (!picked.length) return;
                if (picked.length > 500) { setError("Load up to 500 lyric files at once."); return; }
                setError("");
                const controller = new AbortController();
                batch.current = controller;
                const files = picked.map((file) => ({ filename: file.name, file }));
                setBulkFiles(files);
                setView("bulk");
                setBulkResults(null);
                void onBulk(files, controller.signal).then((results) => {
                  if (!controller.signal.aborted) setBulkResults(results);
                }, (why) => {
                  if (!controller.signal.aborted) { back(); setError(importError(why)); }
                });
              }}
            />
          </div>
        ) : view === "bulk" ? (
          <div className="load-ttml-body">
            <div className="load-ttml-tools">
              <button
                className="load-ttml-back"
                aria-label="Back to Load TTML"
                onClick={back}
              >
                <ChevronLeft size={16} />
                Back
              </button>
            </div>
            <BulkTtml
              files={bulkFiles}
              results={bulkResults}
              search={searchSongs}
              attach={attachSong}
              onDone={onClose}
            />
          </div>
        ) : (
          <div className="load-ttml-body">
            <div className="load-ttml-tools">
              <button
                className="load-ttml-back"
                aria-label="Back to Load TTML"
                onClick={back}
              >
                <ChevronLeft size={16} />
                Back
              </button>
              <label className="load-ttml-search">
                <Search size={15} />
                <input
                  type="search"
                  placeholder="Search saved lyrics…"
                  aria-label="Search saved lyrics"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                />
              </label>
              <button className="load-ttml-reset" disabled={busy || !song} onClick={() => act(onReset)}>
                <RotateCcw size={14} />
                Reset TTML
              </button>
            </div>
            {saved === null ? (
              <p className="load-ttml-empty">Loading saved lyrics…</p>
            ) : saved.length === 0 ? (
              <p className="load-ttml-empty">
                No saved lyrics yet. Persistent loads appear here.
              </p>
            ) : shown.length === 0 ? (
              <p className="load-ttml-empty">No saved lyrics match.</p>
            ) : (
              <ul className="load-ttml-saved">
                {shown.map((item) => {
                  const name = item.name || "Unknown song";
                  return (
                    <li key={item.uri}>
                      {item.image ? (
                        <img src={item.image} alt="" loading="lazy" />
                      ) : (
                        <span className="load-ttml-art" aria-hidden="true">
                          <Music2 size={18} />
                        </span>
                      )}
                      <span className="load-ttml-song">
                        <strong title={name}>{name}</strong>
                        {item.artists && (
                          <small title={item.artists}>{item.artists}</small>
                        )}
                      </span>
                      <span className="load-ttml-row-actions">
                        <button
                          aria-label={`Play ${name}`}
                          title="Play"
                          disabled={busy || !spotifySongKey(item.uri)}
                          onClick={() => act(() => onPlay(item.uri))}
                        >
                          <Play size={14} fill="currentColor" />
                        </button>
                        <button
                          aria-label={`Download lyrics for ${name}`}
                          title={`Download ${item.kind.toUpperCase()}`}
                          onClick={() => onDownload(item)}
                        >
                          <Download size={14} />
                        </button>
                        <button
                          aria-label={`Delete saved lyrics for ${name}`}
                          title="Delete"
                          disabled={busy}
                          onClick={() => act(async () => {
                            await deleteSaved(item.uri);
                            setSaved((items) => (items ?? []).filter((entry) => entry.uri !== item.uri));
                          })}
                        >
                          <Trash2 size={14} />
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
