import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  ChevronLeft,
  Music2,
  Search,
  SkipForward,
  TriangleAlert,
} from "lucide-react";
import type { TtmlTrack as Track } from "../host";
import type { BulkFile, BulkLyric } from "../ttml-import";

function artists(song: Track) {
  return song.artists.map((artist) => artist.name).join(", ");
}

function art(song: Track) {
  const images = song.album?.images ?? [];
  return images[images.length - 1]?.url ?? images[0]?.url;
}

function Art({ song, size }: { song: Track | null; size: number }) {
  const url = song && art(song);
  return url ? (
    <img src={url} alt="" loading="lazy" />
  ) : (
    <span className="load-ttml-art" aria-hidden="true">
      <Music2 size={size} />
    </span>
  );
}

function songList(songs: Track[]) {
  const [first, ...rest] = songs;
  return `${first.name} · ${artists(first)}${rest.length ? ` and ${rest.length} more` : ""}`;
}

/** One file still needing its song: searched straight away with the words
 * its metadata or name gave, then saved for every result ticked (single and
 * album releases of a song are separate tracks) or skipped. */
function MatchStep({
  file,
  query: initial,
  error: initialError,
  search,
  onPick,
  nav,
}: {
  file: BulkFile;
  query: string;
  error: string | null;
  search: (query: string) => Promise<Track[]>;
  onPick: (songs: Track[]) => Promise<void>;
  nav: (save: ReactNode) => ReactNode;
}) {
  const [query, setQuery] = useState(initial);
  const [chosen, setChosen] = useState<Track[]>([]);
  const [found, setFound] = useState<Track[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const find = (words: string) => {
    if (!words.trim()) {
      setFound([]);
      return;
    }
    setBusy(true);
    setError(null);
    search(words.trim())
      .then(setFound, (why) => {
        setFound([]);
        setError(String(why));
      })
      .finally(() => setBusy(false));
  };
  useEffect(() => find(initial), []);
  return (
    <>
      <form
        className="bulk-ttml-find"
        onSubmit={(event) => {
          event.preventDefault();
          find(query);
        }}
      >
        <label className="load-ttml-search">
          <Search size={15} />
          <input
            type="search"
            aria-label={`Song for ${file.filename}`}
            placeholder="Song and artist…"
            value={query}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button type="submit" disabled={busy || !query.trim()}>
          Search
        </button>
      </form>
      {error && (
        <p className="bulk-ttml-error" role="alert">
          <TriangleAlert size={13} aria-hidden="true" />
          {error}
        </p>
      )}
      {found === null ? (
        <p className="bulk-ttml-none" role="status">
          Searching…
        </p>
      ) : found.length ? (
        <ul className="bulk-ttml-results" aria-label="Songs found">
          {found.map((candidate) => {
            const ticked = chosen.some((song) => song.uri === candidate.uri);
            return (
              <li key={candidate.uri}>
                <button
                  disabled={busy}
                  role="checkbox"
                  aria-checked={ticked}
                  aria-label={`Use ${candidate.name} by ${artists(candidate)}`}
                  onClick={() =>
                    setChosen((all) =>
                      ticked
                        ? all.filter((song) => song.uri !== candidate.uri)
                        : [...all, candidate],
                    )
                  }
                >
                  <span className="bulk-ttml-tick" aria-hidden="true">
                    {ticked && <Check size={13} />}
                  </span>
                  <Art song={candidate} size={14} />
                  <span className="load-ttml-song">
                    <strong>{candidate.name}</strong>
                    <small>
                      {artists(candidate)}
                      {candidate.album?.name
                        ? ` · ${candidate.album.name}`
                        : ""}
                    </small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="bulk-ttml-none">
          No songs found. Try other words, or skip this file.
        </p>
      )}
      {nav(
        chosen.length > 0 && (
          <button
            className="bulk-ttml-save"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              onPick(chosen).catch((why) => {
                setError(String(why));
                setBusy(false);
              });
            }}
          >
            Save for {chosen.length} {chosen.length === 1 ? "song" : "songs"}
          </button>
        ),
      )}
    </>
  );
}

/** Bulk Load's results: songs named in the files are saved straight away;
 * the rest are matched one file at a time, and get the picked song's ID
 * written into them. */
export function BulkTtml({
  files,
  results,
  search,
  attach,
  onDone,
}: {
  onDone: () => void;
  files: BulkFile[];
  results: BulkLyric[] | null;
  search: (query: string) => Promise<Track[]>;
  attach: (file: BulkFile, songs: Track[]) => Promise<void>;
}) {
  const [songs, setSongs] = useState<Track[][]>([]);
  const [step, setStep] = useState(0);
  useEffect(() => {
    setSongs(
      results?.map((result) => (result.song ? [result.song] : [])) ?? [],
    );
    setStep(0);
  }, [results]);
  if (!results || songs.length !== results.length)
    return (
      <p className="load-ttml-empty" role="status">
        Matching {files.length} lyric {files.length === 1 ? "file" : "files"}…
      </p>
    );
  // Files that named their song were saved before the steps began.
  const pending = results.flatMap((result, index) =>
    result.song || result.invalid ? [] : [index],
  );
  const saved = songs.filter((list) => list.length).length;
  const current = pending[step];
  if (current === undefined)
    return (
      <>
        <p className="bulk-ttml-summary" role="status">
          {saved} of {results.length} saved
        </p>
        <ul className="bulk-ttml-list" aria-label="Lyric files">
          {results.map((result, index) => {
            const list = songs[index];
            return (
              <li
                key={`${index}-${result.filename}`}
                className="bulk-ttml-file"
                data-state={list.length ? "saved" : "skipped"}
              >
                <div className="bulk-ttml-head">
                  <Art song={list[0] ?? null} size={18} />
                  <span className="load-ttml-song">
                    <strong title={result.filename}>{result.filename}</strong>
                    <small>
                      {list.length ? (
                        <>
                          <Check size={12} aria-hidden="true" /> Saved for{" "}
                          {songList(list)}
                        </>
                      ) : (
                        (result.error ?? "Skipped")
                      )}
                    </small>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        <button className="bulk-ttml-done" onClick={onDone}>
          Done
        </button>
      </>
    );
  const file = files[current];
  const result = results[current];
  return (
    <div className="bulk-ttml-step">
      <p className="bulk-ttml-summary" role="status">
        Song {step + 1} of {pending.length} to match
        {saved ? ` · ${saved} saved` : ""}
      </p>
      <div
        className="bulk-ttml-progress"
        role="progressbar"
        aria-label="Files matched"
        aria-valuemin={0}
        aria-valuemax={pending.length}
        aria-valuenow={step}
      >
        <i style={{ width: `${(step / pending.length) * 100}%` }} />
      </div>
      <div className="bulk-ttml-file" data-state="open">
        <div className="bulk-ttml-head">
          <Art song={songs[current][0] ?? null} size={18} />
          <span className="load-ttml-song">
            <strong title={file.filename}>{file.filename}</strong>
            <small>
              {songs[current].length
                ? `Saved for ${songList(songs[current])}`
                : "Tick its song, or each release of it"}
            </small>
          </span>
        </div>
        <MatchStep
          key={current}
          file={file}
          query={result.query}
          error={result.error}
          search={search}
          onPick={async (picked) => {
            await attach(file, picked);
            setSongs((all) =>
              all.map((value, index) => (index === current ? picked : value)),
            );
            setStep((at) => at + 1);
          }}
          nav={(save) => (
            <div className="bulk-ttml-nav">
              <button
                onClick={() => setStep((at) => at - 1)}
                disabled={step === 0}
              >
                <ChevronLeft size={15} />
                Previous
              </button>
              <span>
                <button onClick={() => setStep((at) => at + 1)}>
                  {songs[current].length ? "Next" : "Skip"}
                  <SkipForward size={14} />
                </button>
                {save}
              </span>
            </div>
          )}
        />
      </div>
    </div>
  );
}
