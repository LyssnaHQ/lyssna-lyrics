import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import {
  ArrowLeft,
  CircleCheck,
  CircleX,
  MessageSquareWarning,
  Play,
  RefreshCw,
  SquarePen,
  X,
} from "lucide-react";
import type { Host } from "../host";
import { cachedLyssnaProfile, readLyssnaProfile } from "../lyssna-account";
import { parseLocalTtml, lyricsChanged } from "../local-lyrics";
import { revalidateLyssnaSong } from "../lyssna-provider";
import { usePlayback } from "../playback";
import { spotifySongUri } from "../spotify-song";
import { TrackArtwork } from "../spotify-artwork";
import { formatTime } from "./ttml-creator-model";
import type { Lyrics } from "./types";
import type { ReviewDraft, ReviewEditor, ReviewOpen } from "./review-editor";
import {
  GRADES,
  REJECT_REASONS,
  addReviewComment,
  decideReview,
  diffLines,
  editKinds,
  reviewComments,
  reviewQueue,
  reviewSubmission,
  reviewTrackInfo,
  revisionTtml,
  submitReviewEdit,
  type DiffRow,
  type EditKind,
  type RejectReason,
  type ReviewAction,
  type ReviewComment,
  type ReviewLane,
  type ReviewSubmission,
  type ReviewTrack,
} from "./review-api";

const ago = (iso: string) => {
  const minutes = Math.max(0, (Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 60 / 24)}d ago`;
};
const who = (submission: ReviewSubmission) =>
  submission.submitter_name ? `@${submission.submitter_name}` : "Deleted user";
const reviewQuoteType = "application/x-lyssna-review-quote";
const decisionNoteLimit = 2000;

/** Waiting submissions by lane; picking one hands it to `onPick`. */
function ReviewQueue({
  host,
  lane,
  onLane,
  onPick,
  onClose,
  onRefresh,
}: {
  host: Host;
  lane: ReviewLane;
  onLane: (lane: ReviewLane) => void;
  onPick: (submission: ReviewSubmission) => void;
  onClose: () => void;
  onRefresh(): void;
}) {
  const [items, setItems] = useState<ReviewSubmission[] | null>(null);
  const [failed, setFailed] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [opening, setOpening] = useState<string>();
  const [openError, setOpenError] = useState<string>();
  const request = useRef(0);
  useEffect(() => {
    let live = true;
    setFailed(undefined);
    setItems(null);
    reviewQueue(lane).then(
      (list) => { if (live) setItems(list ?? []); },
      (error) => { if (live) setFailed(error.message); },
    );
    return () => { live = false; request.current++; };
  }, [lane, refresh]);
  async function pick(item: ReviewSubmission) {
    if (opening) return;
    const id = ++request.current;
    setOpening(item.id);
    setOpenError(undefined);
    try {
      const latest = await reviewSubmission(item.id);
      if (request.current === id) onPick(latest);
    } catch (error) {
      if (request.current === id) setOpenError(String(error));
    } finally {
      if (request.current === id) setOpening(undefined);
    }
  }
  return (
    <>
      <header className="review-head">
        <h3>Review</h3>
        <button className="review-icon" disabled={!!opening} onClick={() => {
          setOpenError(undefined);
          setRefresh((count) => count + 1);
          onRefresh();
        }} title="Refresh" aria-label="Refresh queue">
          <RefreshCw size={15} />
        </button>
        <button className="review-icon" onClick={onClose} aria-label="Close review">
          <X size={16} />
        </button>
      </header>
      <div className="review-queue">
        <div className="review-lanes" role="tablist" aria-label="Review queues">
          {(
            [
              ["priority", "Priority"],
              ["backlog", "Backlog"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={lane === value}
              disabled={!!opening}
              className={lane === value ? "active" : ""}
              onClick={() => { setOpenError(undefined); onLane(value); }}
            >
              {label}
            </button>
          ))}
        </div>
        {openError && <p className="review-empty" role="alert">{openError}</p>}
        {failed ? (
          <p className="review-empty">{failed}</p>
        ) : items === null ? (
          <p className="review-empty">Loading…</p>
        ) : !items.length ? (
          <p className="review-empty">Nothing waiting here.</p>
        ) : (
          <ul className="review-list">
            {items.map((item) => (
              <li key={item.id}>
                <button disabled={!!opening} aria-busy={opening === item.id} onClick={() => void pick(item)}>
                  <ReviewSongRow host={host} submission={item} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function useReviewTrack(host: Host, submission: ReviewSubmission) {
  const [track, setTrack] = useState<ReviewTrack>();
  useEffect(() => {
    let active = true;
    void reviewTrackInfo(submission, host).then(
      info => { if (active) setTrack(info); },
      () => { if (active) setTrack({}); },
    );
    return () => { active = false; };
  }, [host, submission]);
  return track;
}

function ReviewSongRow({ host, submission }: { host: Host; submission: ReviewSubmission }) {
  const track = useReviewTrack(host, submission);
  return (
    <>
      <TrackArtwork className="review-cover" src={track?.cover} />
      <span className="review-song">
        <strong>{submission.song_title}</strong>
        {track?.artists && <span>{track.artists}</span>}
        <small>
          {submission.instrumental ? "Instrumental" : submission.kind === "edit" ? "Edit" : "New"} · {who(submission)} ·
          Tier {submission.submitter_tier} · {ago(submission.submitted_at)}
          {submission.major_rewrite
            ? " · Major rewrite"
            : submission.light_review
              ? " · Light review"
              : ""}
        </small>
      </span>
    </>
  );
}

export function ReviewPanel({ host, editor, onPlay, onOpen, onRefresh, onClose }: {
  host: Host;
  editor: ReviewEditor;
  onPlay(uri: string): void;
  onOpen(open: ReviewOpen): void;
  onRefresh(): void;
  onClose(): void;
}) {
  const [picked, setPicked] = useState<ReviewSubmission>();
  const [lane, setLane] = useState<ReviewLane>("priority");
  const [notice, setNotice] = useState("");
  const { track, playing } = usePlayback(host);
  const editing = useSyncExternalStore(editor.subscribe, editor.draft);
  const opening = useSyncExternalStore(editor.subscribe, editor.request);
  const panel = useRef<HTMLElement>(null);
  useLayoutEffect(() => panel.current?.focus({ preventScroll: true }), []);
  const back = () => {
    const request = editor.request();
    if (request && request.submission.id === picked?.id) editor.cancel(request);
    setPicked(undefined);
  };
  return (
    <aside className="review-panel" aria-label="Review" ref={panel} tabIndex={-1}>
      {picked ? (
        <ReviewDetail key={picked.id} host={host} submission={picked}
          playingUri={playing && track ? spotifySongUri(track.id) : undefined}
          editing={editing?.id === picked.id && editing.revision === picked.head_revision_id ? editing : undefined}
          opening={opening?.submission.id === picked.id}
          onPlay={onPlay} onOpen={onOpen} onClose={onClose} onBack={back}
          onDecided={(message) => { setNotice(message); onRefresh(); setPicked(undefined); }} onRefresh={onRefresh} />
      ) : (
        <ReviewQueue host={host} lane={lane} onLane={setLane} onPick={(submission) => {
          setNotice("");
          setPicked(submission);
        }} onClose={onClose} onRefresh={onRefresh} />
      )}
      {notice && <p className="review-notice" role="status">{notice}</p>}
    </aside>
  );
}

function ReviewDetail({ host, submission, playingUri, editing, opening, onPlay, onOpen, onDecided, onRefresh, onBack, onClose }: {
  host: Host;
  submission: ReviewSubmission;
  playingUri?: string;
  editing?: ReviewDraft;
  opening: boolean;
  onPlay(uri: string): void;
  onOpen(open: ReviewOpen): void;
  onDecided(message: string): void;
  onRefresh(): void;
  onBack(): void;
  onClose(): void;
}) {
  const track = useReviewTrack(host, submission);
  const uri = track?.uri;
  const [ttml, setTtml] = useState<string | null>();
  const [preview, setPreview] = useState<Lyrics>();
  const [showPreview, setShowPreview] = useState(false);
  const [diff, setDiff] = useState<DiffRow[] | null>();
  const [kinds, setKinds] = useState<{ kind: EditKind; lines: number }[]>([]);
  const [comments, setComments] = useState<ReviewComment[]>();
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [commentError, setCommentError] = useState(false);
  const [grade, setGrade] = useState<1 | 2 | 3>(3);
  const [note, setNote] = useState("");
  const [quoteTooLong, setQuoteTooLong] = useState(false);
  const [reason, setReason] = useState<RejectReason>("low_effort");
  const [busy, setBusy] = useState(false);
  const [correction, setCorrection] = useState<{ original: ReviewSubmission; ttml: string; username: string }>();
  const [decisionError, setDecisionError] = useState("");
  const [outcome, setOutcome] = useState<ReviewAction>("approve");
  const id = submission.id;
  useEffect(() => {
    let live = true;
    if (submission.head_revision_id && !submission.instrumental)
      revisionTtml(submission.head_revision_id).then(
        (text) => {
          if (!live) return;
          setTtml(text);
          try { setPreview(parseLocalTtml(text)); }
          catch (error) { host.notifyError(String(error)); }
        },
        (error) => {
          if (!live) return;
          setTtml(null);
          host.notifyError(String(error));
        },
      );
    reviewComments(id).then(
      (list) => live && setComments(list),
      () => live && setCommentError(true),
    );
    return () => {
      live = false;
    };
  }, [submission, id, host]);
  useEffect(() => {
    if (!ttml || submission.kind !== "edit" || !submission.base_revision_id)
      return setDiff(null);
    let live = true;
    const lines = (lyrics: Lyrics) =>
      lyrics.lines
        .filter((line) => !line.background)
        .map((line) => ({ text: line.text, startMs: line.start_ms }));
    revisionTtml(submission.base_revision_id)
      .then((base) => [parseLocalTtml(base), parseLocalTtml(ttml)] as const)
      .then(
        ([before, after]) => {
          if (!live) return;
          setDiff(diffLines(lines(before), lines(after)));
          setKinds(editKinds(before, after));
        },
        () => live && setDiff(null),
      );
    return () => {
      live = false;
    };
  }, [ttml, submission]);
  const playingIt = !!uri && playingUri === uri;
  const instrumental = !!submission.instrumental;
  const canDecide = instrumental || !!ttml;
  const refreshPublished = (published: ReviewSubmission) => {
    const trackId = uri?.split(":").at(-1);
    if (!trackId) return;
    revalidateLyssnaSong(trackId, undefined, published.head_revision_id
      ? { songId: published.song_id, revision: published.head_revision_id }
      : undefined);
    window.dispatchEvent(new CustomEvent(lyricsChanged, { detail: [trackId] }));
  };
  const publishCorrection = async (saved: NonNullable<typeof correction>) => {
    try {
      const edited = await submitReviewEdit(saved.original, saved.ttml, saved.username);
      if (edited.status === "approved") refreshPublished(edited);
      onDecided(edited.status === "approved"
        ? `Approved ${submission.song_title}. Your edit is live on Lyssna.`
        : `Approved ${submission.song_title}. Your edit was submitted separately.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDecisionError(message);
      host.notifyError(`Original approved. Couldn’t confirm your edit. ${message}`);
    }
  };
  const retryCorrection = async () => {
    if (busy || !correction) return;
    setBusy(true);
    setDecisionError("");
    try { await publishCorrection(correction); }
    finally { setBusy(false); }
  };
  const decide = async (action: ReviewAction, withEdits = false) => {
    if (busy || submission.status !== "pending" || !canDecide) return;
    if (withEdits && !editing?.changed) return;
    setBusy(true);
    setDecisionError("");
    try {
      const edit = withEdits && editing ? editing.save() : undefined;
      if (withEdits && !edit) throw new Error("The editor draft is unavailable.");
      const account = edit ? cachedLyssnaProfile() ?? await readLyssnaProfile() : undefined;
      if (edit && !account) throw new Error("Sign in to Lyssna to submit your edit.");
      const latest = await reviewSubmission(id);
      if (latest.status !== "pending" || latest.head_revision_id !== submission.head_revision_id ||
        !!latest.instrumental !== instrumental) {
        host.notifyError("This submission changed. Open it again from the queue.");
        onRefresh();
        onBack();
        return;
      }
      const decided = await decideReview(id, action, {
        grade: action === "approve" && !instrumental ? grade : undefined,
        reason: action === "reject" ? reason : undefined,
        note: note.trim() || undefined,
      });
      if (action === "approve") refreshPublished(decided);
      if (edit && account) {
        const saved = { original: decided, ttml: edit, username: account.username };
        setCorrection(saved);
        onRefresh();
        await publishCorrection(saved);
        return;
      }
      onDecided(
        action === "approve"
          ? `Approved ${submission.song_title}.`
          : action === "reject"
            ? `Rejected ${submission.song_title}.`
            : `Asked for changes to ${submission.song_title}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDecisionError(message);
      host.notifyError(message);
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    const body = reply.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const comment = await addReviewComment(id, body);
      setComments((list) => [...(list ?? []), comment]);
      setReply((current) => current.trim() === body ? "" : current);
    } catch (error) {
      host.notifyError(String(error));
    } finally {
      setSending(false);
    }
  };
  const changed = diff?.filter((row) => row.kind !== "same" || row.retimed);

  const quoteDrag = (text: string, startMs?: number) => {
    if (submission.status !== "pending" || correction || busy || !text.trim()) return {};
    return {
      draggable: true,
      title: "Drag into the decision note to quote",
      onDragStart(event: DragEvent<HTMLLIElement>) {
        const time = startMs !== undefined ? `${formatTime(startMs)} ` : "";
        event.dataTransfer.setData(reviewQuoteType, `${time}“${text.trim()}”`);
        event.dataTransfer.effectAllowed = "copy";
      },
    };
  };
  const dropQuote = (event: DragEvent<HTMLTextAreaElement>) => {
    delete event.currentTarget.dataset.quoteOver;
    const quote = event.dataTransfer.getData(reviewQuoteType);
    if (!quote) return;
    event.preventDefault();
    event.stopPropagation();
    const separator = note && !note.endsWith("\n") ? "\n" : "";
    const next = note + separator + quote;
    setQuoteTooLong(next.length > decisionNoteLimit);
    if (next.length <= decisionNoteLimit) setNote(next);
    event.currentTarget.focus({ preventScroll: true });
  };

  return (
    <div className="review-detail">
      <header className="review-head">
        <button className="review-icon" disabled={busy} onClick={onBack} aria-label="Back to the queue">
          <ArrowLeft size={16} />
        </button>
        <TrackArtwork className="review-cover" src={track?.cover} />
        <h3 title={submission.song_title}>{submission.song_title}</h3>
        <button className="review-icon" onClick={onClose} aria-label="Close review">
          <X size={16} />
        </button>
      </header>
      <p className="review-meta">
        {instrumental ? "Marked instrumental" : submission.kind === "edit" ? "Edit" : "New lyrics"} by{" "}
        {who(submission)} · Tier {submission.submitter_tier} ·{" "}
        {ago(submission.submitted_at)}
      </p>
      <div className="review-buttons">
        <button
          disabled={!uri || opening || busy || (!instrumental && !!submission.head_revision_id && ttml === undefined)}
          title={track && !uri ? "No Spotify link for this song" : undefined}
          onClick={() => {
            if (!uri) return;
            if (ttml && !editing && !instrumental && !correction) onOpen({ submission, uri, ttml, play: true });
            else onPlay(uri);
          }}
        >
          <Play size={14} /> {playingIt ? "Playing" : "Play song"}
        </button>
        {!instrumental && !correction && <button
          disabled={!uri || !ttml || !!editing || opening || busy}
          onClick={() => uri && ttml && onOpen({ submission, uri, ttml, play: false })}
        >
          <SquarePen size={14} />{" "}
          {opening ? "Opening…" : editing ? "Opened in editor" : "Open in editor"}
        </button>}
      </div>
      {instrumental && <p className="review-instrumental">
        This submission marks the song as instrumental. Listen to confirm before approving.
      </p>}
      {preview && (
        <section className="review-section">
          <div className="review-buttons">
            <button aria-expanded={showPreview} onClick={() => setShowPreview(!showPreview)}>
              {showPreview ? "Hide submitted lyrics" : "Show submitted lyrics"}
            </button>
          </div>
          {showPreview && <ol className="review-diff">
            {preview.lines.map((line, index) => (
              <li key={index} {...quoteDrag(line.text, preview.synced ? line.start_ms : undefined)}>{line.text}</li>
            ))}
          </ol>}
        </section>
      )}
      {submission.kind === "edit" && !instrumental && (
        <section className="review-section">
          <h4>Changes</h4>
          {!!kinds.length && (
            <ul className="review-kinds">
              {kinds.map(({ kind, lines }) => (
                <li key={kind}>
                  {kind}{" "}
                  <span>
                    {lines} {lines === 1 ? "line" : "lines"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {diff === undefined ? (
            <p className="review-empty">Comparing…</p>
          ) : diff === null ? (
            <p className="review-empty">
              Couldn't compare with the live lyrics.
            </p>
          ) : !changed?.length ? (
            !kinds.length && (
              <p className="review-empty">
                No line changes; only song details differ.
              </p>
            )
          ) : (
            <ol className="review-diff">
              {diff.map((row, index) =>
                row.kind === "same" && !row.retimed ? null : (
                  <li
                    key={index}
                    data-kind={row.kind === "same" ? "retimed" : row.kind}
                    {...quoteDrag(row.text)}
                  >
                    {row.text || "(empty line)"}
                  </li>
                ),
              )}
            </ol>
          )}
        </section>
      )}
      <section className="review-section">
        <h4>Comments</h4>
        {commentError && !comments ? (
          <p className="review-empty">Couldn’t load comments.</p>
        ) : comments === undefined ? (
          <p className="review-empty">Loading…</p>
        ) : !comments.length ? (
          <p className="review-empty">No comments yet.</p>
        ) : (
          <ul className="review-comments">
            {comments.map((comment) => (
              <li key={comment.id}>
                <strong>
                  {comment.author_name
                    ? `@${comment.author_name}`
                    : "Deleted user"}
                </strong>
                <p>{comment.body}</p>
              </li>
            ))}
          </ul>
        )}
        <div className="review-reply">
          <input
            value={reply}
            placeholder="Comment to the submitter"
            aria-label="Comment"
            maxLength={2000}
            onChange={(event) => setReply(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && void send()}
          />
          <button onClick={() => void send()} disabled={!reply.trim() || sending}>
            Send
          </button>
        </div>
      </section>
      {correction ? (
        <section className="review-section">
          <h4>Original approved</h4>
          {decisionError
            ? <><p role="alert">{decisionError}</p>
                <button disabled={busy} onClick={() => void retryCorrection()}>Retry submitting your edit</button></>
            : <p role="status">Submitting your edit…</p>}
        </section>
      ) : submission.status !== "pending" ? (
        <p className="review-empty">This submission is no longer waiting for review.</p>
      ) : <section className="review-section review-decide" data-outcome={outcome}>
        <h4>Decision</h4>
        {decisionError && <p className="review-empty" role="alert">{decisionError}</p>}
        <div
          className="review-outcomes"
          role="radiogroup"
          aria-label="Decision"
        >
          {(
            [
              ["approve", "Approve", CircleCheck],
              ["request-changes", "Changes", MessageSquareWarning],
              ["reject", "Reject", CircleX],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              role="radio"
              aria-checked={outcome === value}
              data-outcome={value}
              onClick={() => setOutcome(value)}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
        {outcome === "approve" && !instrumental && (
          <>
            <small className="review-label">Quality</small>
            <div
              className="review-choice"
              role="radiogroup"
              aria-label="Quality"
            >
              {GRADES.map(([value, label]) => (
                <button
                  key={value}
                  role="radio"
                  aria-checked={grade === value}
                  className={grade === value ? "active" : ""}
                  onClick={() => setGrade(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
        {outcome === "reject" && (
          <>
            <small className="review-label">Reason</small>
            <div
              className="review-choice"
              role="radiogroup"
              aria-label="Reject reason"
            >
              {REJECT_REASONS.map(([value, label]) => (
                <button
                  key={value}
                  role="radio"
                  aria-checked={reason === value}
                  className={reason === value ? "active" : ""}
                  onClick={() => setReason(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
        <textarea
          value={note}
          placeholder={
            outcome === "request-changes"
              ? "What should the submitter change?"
              : "Note for the submitter (optional)"
          }
          aria-label="Decision note"
          maxLength={decisionNoteLimit}
          onChange={(event) => { setNote(event.target.value); setQuoteTooLong(false); }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes(reviewQuoteType)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            event.currentTarget.dataset.quoteOver = "";
          }}
          onDragLeave={(event) => { delete event.currentTarget.dataset.quoteOver; }}
          onDrop={dropQuote}
        />
        {quoteTooLong && <p className="review-empty" role="alert">This quote would exceed the 2,000-character note limit.</p>}
        <div className="review-buttons">
          {outcome === "approve" ? (
            <>
              <button
                className="review-confirm"
                disabled={busy || !canDecide}
                onClick={() => void decide("approve")}
              >
                <CircleCheck size={14} /> {instrumental ? "Approve as instrumental" : "Approve"}
              </button>
              {!instrumental && <button
                disabled={busy || !ttml || !editing?.changed}
                title={
                  editing?.changed
                    ? "Approve, then submit your corrections as an edit credited to you"
                    : "Open it in the editor and make corrections first"
                }
                onClick={() => void decide("approve", true)}
              >
                <SquarePen size={14} /> Approve with edits
              </button>}
            </>
          ) : outcome === "request-changes" ? (
            <button
              className="review-confirm"
              disabled={busy || !canDecide || !note.trim()}
              title={
                note.trim() ? undefined : "Write a note saying what to change"
              }
              onClick={() => void decide("request-changes")}
            >
              <MessageSquareWarning size={14} /> Ask for changes
            </button>
          ) : (
            <button
              className="review-confirm"
              disabled={busy || !canDecide}
              onClick={() => void decide("reject")}
            >
              <CircleX size={14} /> Reject
            </button>
          )}
        </div>
      </section>}
    </div>
  );
}
