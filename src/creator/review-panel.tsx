import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Maximize2,
  Minimize2,
  CircleCheck,
  CircleX,
  MessageSquareWarning,
  Play,
  RefreshCw,
  SquarePen,
  X,
} from "lucide-react";
import type { Lyrics, Track } from "./types";
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
  reviewTrackUri,
  revisionTtml,
  type DiffRow,
  type EditKind,
  type RejectReason,
  type ReviewAction,
  type ReviewComment,
  type ReviewLane,
  type ReviewSubmission,
} from "./review-api";

export interface ReviewOpen {
  submission: ReviewSubmission;
  uri: string;
  ttml: string;
}

const ago = (iso: string) => {
  const minutes = Math.max(0, (Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 60 / 24)}d ago`;
};
const who = (submission: ReviewSubmission) =>
  submission.submitter_name ? `@${submission.submitter_name}` : "Deleted user";

/** Waiting submissions by lane; picking one hands it to `onPick`. */
function ReviewQueue({
  lane,
  onLane,
  onPick,
  onClose,
}: {
  lane: ReviewLane;
  onLane: (lane: ReviewLane) => void;
  onPick: (submission: ReviewSubmission) => void;
  onClose: () => void;
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
        <button disabled={!!opening} onClick={() => {
          setOpenError(undefined);
          setRefresh((count) => count + 1);
        }} title="Refresh" aria-label="Refresh queue">
          <RefreshCw size={15} />
        </button>
        <button onClick={onClose} aria-label="Close review">
          <X size={16} />
        </button>
      </header>
      <div className="review-lanes" role="tablist">
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
                <ReviewSongRow submission={item} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ReviewSongRow({ submission }: { submission: ReviewSubmission }) {
  return (
    <>
      <span className="review-song">
        <strong>{submission.song_title}</strong>
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

/** The TTML Creator's review side panel: a submission's changes, comments
 *  and decision, or the queue to pick another. */
export function ReviewPanel({
  playing,
  isPlaying,
  editing,
  opening,
  editorTtml,
  onPlay,
  onOpen,
  onCancelOpen,
  onParse,
  onSubmitFix,
  onDecided,
  notify,
  onClose,
}: {
  playing?: Track;
  isPlaying: boolean;
  /** The submission loaded in the editor and the TTML it opened with. */
  editing?: { id: string; baseline: string };
  opening?: string;
  editorTtml: () => string;
  onPlay: (uri: string) => void;
  onOpen: (open: ReviewOpen, play?: boolean) => void;
  onCancelOpen: () => void;
  onParse: (ttml: string) => Promise<Lyrics>;
  onSubmitFix: (ttml: string) => Promise<void>;
  onDecided: (submission: ReviewSubmission, action: ReviewAction, uri: string | null | undefined) => void;
  notify: (message: string, error?: boolean) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<ReviewSubmission>();
  const [lane, setLane] = useState<ReviewLane>("priority");
  const [minimised, setMinimised] = useState(false);
  const panel = useRef<HTMLElement>(null);
  useLayoutEffect(() => panel.current?.focus({ preventScroll: true }), []);
  return (
    <aside
      className={`review-panel${minimised ? " minimised" : ""}`}
      aria-label="Review"
      ref={panel}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      {minimised && picked && (
        <button
          className="review-restore"
          onClick={() => setMinimised(false)}
          aria-label="Show review"
        >
          <span>
            Reviewing <strong>{picked.song_title}</strong>
          </span>
          <Maximize2 size={14} />
        </button>
      )}
      {picked ? (
        <ReviewDetail
          hidden={minimised}
          onMinimise={() => setMinimised(true)}
          key={picked.id}
          submission={picked}
          playing={playing}
          isPlaying={isPlaying}
          editing={editing?.id === picked.id ? editing : undefined}
          opening={opening === picked.id}
          editorTtml={editorTtml}
          onPlay={onPlay}
          onOpen={onOpen}
          onParse={onParse}
          onSubmitFix={onSubmitFix}
          notify={notify}
          onClose={onClose}
          onBack={() => {
            onCancelOpen();
            setMinimised(false);
            setPicked(undefined);
          }}
          onDecided={(submission, action, uri) => {
            setMinimised(false);
            setPicked(undefined);
            onDecided(submission, action, uri);
          }}
        />
      ) : (
        <ReviewQueue lane={lane} onLane={setLane} onPick={setPicked} onClose={onClose} />
      )}
    </aside>
  );
}

function ReviewDetail({
  submission,
  playing,
  isPlaying,
  editing,
  opening,
  editorTtml,
  onPlay,
  onOpen,
  onParse,
  onSubmitFix,
  notify,
  onBack,
  onClose,
  hidden,
  onMinimise,
  onDecided,
}: {
  submission: ReviewSubmission;
  playing?: Track;
  isPlaying: boolean;
  editing?: { id: string; baseline: string };
  opening: boolean;
  editorTtml: () => string;
  onPlay: (uri: string) => void;
  onOpen: (open: ReviewOpen, play?: boolean) => void;
  onParse: (ttml: string) => Promise<Lyrics>;
  onSubmitFix: (ttml: string) => Promise<void>;
  notify: (message: string, error?: boolean) => void;
  onBack: () => void;
  onClose: () => void;
  hidden: boolean;
  onMinimise: () => void;
  onDecided: (submission: ReviewSubmission, action: ReviewAction, uri: string | null | undefined) => void;
}) {
  const [uri, setUri] = useState<string | null>();
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
  const [reason, setReason] = useState<RejectReason>("low_effort");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ReviewAction>("approve");
  const id = submission.id;
  // Callers pass fresh callbacks each render; the fetches below run once.
  const parse = useRef(onParse);
  parse.current = onParse;
  const tell = useRef(notify);
  tell.current = notify;
  useEffect(() => {
    let live = true;
    void reviewTrackUri(submission).then(
      (found) => live && setUri(found ?? null),
    );
    if (submission.head_revision_id && !submission.instrumental)
      revisionTtml(submission.head_revision_id).then(
        (text) => {
          if (!live) return;
          setTtml(text);
          void parse.current(text).then(
            (lyrics) => { if (live) setPreview(lyrics); },
            (error) => { if (live) tell.current(String(error), true); },
          );
        },
        (error) => {
          if (!live) return;
          setTtml(null);
          tell.current(String(error), true);
        },
      );
    reviewComments(id).then(
      (list) => live && setComments(list),
      () => live && setCommentError(true),
    );
    return () => {
      live = false;
    };
  }, [submission, id]);
  useEffect(() => {
    if (!ttml || submission.kind !== "edit" || !submission.base_revision_id)
      return setDiff(null);
    let live = true;
    const lines = (lyrics: Lyrics) =>
      lyrics.lines
        .filter((line) => !line.background)
        .map((line) => ({ text: line.text, startMs: line.start_ms }));
    revisionTtml(submission.base_revision_id)
      .then((base) => Promise.all([parse.current(base), parse.current(ttml)]))
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
  const playingIt = isPlaying && !!uri && playing?.uri === uri;
  const instrumental = !!submission.instrumental;
  const canDecide = instrumental || !!ttml;
  const fixed = !instrumental && !!editing && editorTtml() !== editing.baseline;
  const decide = async (
    action: "approve" | "reject" | "request-changes",
    then?: () => Promise<void>,
  ) => {
    if (busy || submission.status !== "pending" || !canDecide) return;
    setBusy(true);
    try {
      const latest = await reviewSubmission(id);
      if (latest.status !== "pending" || latest.head_revision_id !== submission.head_revision_id ||
        !!latest.instrumental !== instrumental) {
        notify("This submission changed. Open it again from the queue.", true);
        onBack();
        return;
      }
      const decided = await decideReview(id, action, {
        grade: action === "approve" && !instrumental ? grade : undefined,
        reason: action === "reject" ? reason : undefined,
        note: note.trim() || undefined,
      });
      if (then) {
        try { await then(); }
        catch (error) {
          notify(`Approved ${submission.song_title}. Couldn’t submit your corrections: ${String(error)}`, true);
          onDecided(decided, action, uri);
          return;
        }
      }
      notify(
        action === "approve"
          ? `Approved ${submission.song_title}.`
          : action === "reject"
            ? `Rejected ${submission.song_title}.`
            : `Asked for changes to ${submission.song_title}.`,
      );
      onDecided(decided, action, uri);
    } catch (error) {
      notify(String(error), true);
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
      notify(String(error), true);
    } finally {
      setSending(false);
    }
  };
  const changed = diff?.filter((row) => row.kind !== "same" || row.retimed);

  return (
    <div className="review-detail" hidden={hidden}>
      <header className="review-head">
        <button onClick={onBack} aria-label="Back to the queue">
          <ArrowLeft size={16} />
        </button>
        <h3 title={submission.song_title}>{submission.song_title}</h3>
        <button
          onClick={onMinimise}
          title="Minimise, to work on the lyrics"
          aria-label="Minimise review"
        >
          <Minimize2 size={15} />
        </button>
        <button onClick={onClose} aria-label="Close review">
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
          disabled={!uri || opening || (!instrumental && !!submission.head_revision_id && ttml === undefined)}
          title={uri === null ? "No Spotify link for this song" : undefined}
          onClick={() => {
            if (!uri) return;
            if (ttml && !editing && !instrumental) onOpen({ submission, uri, ttml }, true);
            else onPlay(uri);
          }}
        >
          <Play size={14} /> {playingIt ? "Playing" : "Play song"}
        </button>
        {!instrumental && <button
          disabled={!uri || !ttml || !!editing || opening}
          onClick={() => uri && ttml && onOpen({ submission, uri, ttml })}
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
            {preview.lines.map((line, index) => <li key={index}>{line.text}</li>)}
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
      {submission.status !== "pending" ? (
        <p className="review-empty">This submission is no longer waiting for review.</p>
      ) : <section className="review-section review-decide" data-outcome={outcome}>
        <h4>Decision</h4>
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
          maxLength={2000}
          onChange={(event) => setNote(event.target.value)}
        />
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
                disabled={busy || !ttml || !fixed}
                title={
                  fixed
                    ? "Approve, then submit your corrections as an edit credited to you"
                    : "Open it in the editor and make corrections first"
                }
                onClick={() =>
                  void decide("approve", () => onSubmitFix(editorTtml()))
                }
              >
                <SquarePen size={14} /> Fix and approve
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
