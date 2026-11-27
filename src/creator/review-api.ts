import type { Host } from "../host";
import { cachedLyssnaProfile, hasLyssnaSession, lyssnaAccountRequest, readLyssnaProfile } from "../lyssna-account";
import type { Line, Lyrics } from "./types";

export type ReviewLane = "priority" | "backlog";
export type ReviewAction = "approve" | "reject" | "request-changes";
export type RejectReason =
  "low_effort" | "wrong_song" | "duplicate" | "spam" | "other";

export const REJECT_REASONS: [RejectReason, string][] = [
  ["low_effort", "Low effort"],
  ["wrong_song", "Wrong song"],
  ["duplicate", "Duplicate"],
  ["spam", "Spam"],
  ["other", "Other"],
];
export const GRADES: [1 | 2 | 3, string][] = [
  [3, "Clean"],
  [2, "Minor fixes"],
  [1, "Heavy fixes"],
];

export interface ReviewLink {
  platform: string;
  external_id: string;
}

export interface ReviewSubmission {
  id: string;
  song_id: string;
  song_title: string;
  kind: "new" | "edit";
  instrumental?: boolean;
  base_revision_id?: string;
  head_revision_id?: string;
  submitter_id: string;
  submitter_name?: string;
  submitter_tier: number;
  status: string;
  proposed_links: ReviewLink[];
  major_rewrite: boolean;
  light_review: boolean;
  priority: boolean;
  submitted_at: string;
  decision_note?: string;
  head_score: number;
  head_votes: number;
}

export interface ReviewComment {
  id: string;
  author_id: string;
  author_name?: string;
  body: string;
  created_at: string;
}

interface ReviewSong {
  id: string;
  title: string;
  artists?: string[];
  links?: ReviewLink[];
  current_revision_id?: string;
}

async function request(path: string, body?: object) {
  const response = await lyssnaAccountRequest(path, body);
  if (response?.ok) return response;
  const problem = await response?.json().catch(() => undefined) as { error?: string; message?: string } | undefined;
  if (!hasLyssnaSession() || response?.status === 401) {
    throw new Error("Sign in to Lyssna in Settings to review lyrics.");
  }
  if (problem?.error === "insufficient_scope") {
    throw new Error("This Lyssna sign-in lacks review access. Sign in again from Settings.");
  }
  if (response?.status === 403) throw new Error("Your Lyssna account can’t review this submission.");
  throw new Error(problem?.message || "Lyssna is temporarily unavailable. Try again later.");
}

const get = async <T>(path: string): Promise<T> => (await request(path)).json();
const post = async <T>(path: string, body: object): Promise<T> => (await request(path, body)).json();
const segment = (value: string) => encodeURIComponent(value);

export const reviewQueue = (lane: ReviewLane, limit = 50) =>
  get<ReviewSubmission[]>(`/v1/queue?lane=${lane}&limit=${limit}`);
export const reviewSubmission = (id: string) =>
  get<ReviewSubmission>(`/v1/submissions/${segment(id)}`);
export const reviewComments = (id: string) =>
  get<ReviewComment[]>(`/v1/submissions/${segment(id)}/comments`);
export const addReviewComment = (id: string, body: string) =>
  post<ReviewComment>(`/v1/submissions/${segment(id)}/comments`, { body });
export const revisionTtml = async (id: string) =>
  (await request(`/v1/revisions/${segment(id)}/ttml`)).text();
export const decideReview = (
  id: string,
  action: ReviewAction,
  decision: { grade?: number; reason?: RejectReason; note?: string },
) => post<ReviewSubmission>(`/v1/submissions/${segment(id)}/${action}`, decision);

export async function submitReviewEdit(original: ReviewSubmission, ttml: string, username: string) {
  const song = await get<ReviewSong>(`/v1/songs/${segment(original.song_id)}`);
  if (!original.head_revision_id || song.current_revision_id !== original.head_revision_id) {
    throw new Error("The live lyrics changed after approval. Check them before submitting your edit.");
  }
  const account = cachedLyssnaProfile() ?? await readLyssnaProfile();
  if (account?.username !== username || !canReview(account.role)) {
    throw new Error("Sign in with the Lyssna account that approved this submission.");
  }
  // This is the reviewer's own revision, independent of the admin upload identity.
  return post<ReviewSubmission>("/v1/submissions", { song_id: original.song_id, ttml });
}

/** The Spotify track a submission is for: the song's own link, or for a new
 *  song, the one its submitter proposed. */
async function reviewTrack(submission: ReviewSubmission) {
  const spotify = (links?: ReviewLink[]) =>
    links?.find(
      (link) =>
        link.platform === "spotify" &&
        /^[A-Za-z0-9]{22}$/.test(link.external_id),
    )?.external_id;
  const proposed = spotify(submission.proposed_links);
  if (proposed) return { id: proposed };
  const song = await get<ReviewSong>(`/v1/songs/${segment(submission.song_id)}`).catch(
    () => undefined,
  );
  const linked = spotify(song?.links);
  return { id: linked, artists: song?.artists?.join(", ") };
}

export type ReviewTrack = { uri?: string; cover?: string; artists?: string };
const reviewTracks = new Map<string, Promise<ReviewTrack>>();

export function reviewTrackInfo(submission: ReviewSubmission, host: Host) {
  const cached = reviewTracks.get(submission.id);
  if (cached) return cached;
  const info = reviewTrack(submission).then(async ({ id, artists }) => {
    if (!id) return { artists };
    const uri = `spotify:track:${id}`;
    const playing = host.track();
    if (playing?.id === id && playing.cover) return { uri, cover: playing.cover, artists: playing.artists };
    const track = await host.lookupTrack(id).catch(() => undefined);
    const covers = track?.album?.images;
    return { uri, cover: covers?.at(-1)?.url, artists: track?.artists?.map(artist => artist.name).join(", ") || artists };
  });
  reviewTracks.set(submission.id, info);
  if (reviewTracks.size > 128) reviewTracks.delete(reviewTracks.keys().next().value!);
  void info.then(track => {
    if (!track.cover && reviewTracks.get(submission.id) === info) reviewTracks.delete(submission.id);
  }, () => {
    if (reviewTracks.get(submission.id) === info) reviewTracks.delete(submission.id);
  });
  return info;
}

export const REVIEWER_ROLES = ["reviewer", "moderator", "admin"];
export const canReview = (role?: string | null) =>
  !!role && REVIEWER_ROLES.includes(role);

export interface DiffLine {
  text: string;
  startMs?: number;
}
export type DiffRow =
  | { kind: "same"; text: string; retimed: boolean }
  | { kind: "added"; text: string }
  | { kind: "removed"; text: string };

// A line counts as retimed when its start moves more than this.
const RETIMED_MS = 40;

/** What an edit changes line by line: lines matched by their words, and
 *  matched lines flagged when their timing moved. */
export function diffLines(base: DiffLine[], head: DiffLine[]): DiffRow[] {
  const key = (line: DiffLine) => line.text.trim().toLowerCase();
  const rows = base.length;
  const cols = head.length;
  const lengths = Array.from({ length: rows + 1 }, () =>
    new Array<number>(cols + 1).fill(0),
  );
  for (let row = rows - 1; row >= 0; row--)
    for (let col = cols - 1; col >= 0; col--)
      lengths[row][col] =
        key(base[row]) === key(head[col])
          ? lengths[row + 1][col + 1] + 1
          : Math.max(lengths[row + 1][col], lengths[row][col + 1]);
  const out: DiffRow[] = [];
  let row = 0;
  let col = 0;
  while (row < rows && col < cols) {
    if (key(base[row]) === key(head[col])) {
      const before = base[row].startMs;
      const after = head[col].startMs;
      out.push({
        kind: "same",
        text: head[col].text,
        retimed:
          before !== undefined &&
          after !== undefined &&
          Math.abs(before - after) > RETIMED_MS,
      });
      row++;
      col++;
    } else if (lengths[row + 1][col] >= lengths[row][col + 1])
      out.push({ kind: "removed", text: base[row++].text });
    else out.push({ kind: "added", text: head[col++].text });
  }
  while (row < rows) out.push({ kind: "removed", text: base[row++].text });
  while (col < cols) out.push({ kind: "added", text: head[col++].text });
  return out;
}

const EDIT_KINDS = [
  "Lyrics",
  "Sections",
  "Singers",
  "Syllables",
  "Timing",
  "Background vocals",
  "Translations",
  "Romanization",
] as const;
export type EditKind = (typeof EDIT_KINDS)[number];

const lineKey = (line: Line) =>
  `${line.background ? "bg:" : ""}${line.text.trim().toLowerCase()}`;
const voicedWords = (line: Line) =>
  line.words
    .filter((word) => word.sung_by)
    .map((word) => `${word.text.trim()}:${word.sung_by}`)
    .join("|");
const moved = (a: number, b: number) => Math.abs(a - b) > RETIMED_MS;

/** What sort of edit a submission is, with how many lines each kind touches,
 *  so a reviewer can tell a sections pass from a retime at a glance. */
export function editKinds(
  before: Lyrics,
  after: Lyrics,
): { kind: EditKind; lines: number }[] {
  const base = before.lines;
  const head = after.lines;
  const width = head.length + 1;
  const best = new Uint16Array((base.length + 1) * width);
  for (let i = base.length - 1; i >= 0; i--)
    for (let j = head.length - 1; j >= 0; j--)
      best[i * width + j] =
        lineKey(base[i]) === lineKey(head[j])
          ? best[(i + 1) * width + j + 1] + 1
          : Math.max(best[(i + 1) * width + j], best[i * width + j + 1]);

  const counts = new Map<EditKind, number>();
  const add = (kind: EditKind) => counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const unmatched = (line: Line) =>
    add(line.background ? "Background vocals" : "Lyrics");
  let i = 0;
  let j = 0;
  while (i < base.length && j < head.length) {
    if (lineKey(base[i]) !== lineKey(head[j])) {
      if (best[(i + 1) * width + j] >= best[i * width + j + 1])
        unmatched(base[i++]);
      else unmatched(head[j++]);
      continue;
    }
    const a = base[i++];
    const b = head[j++];
    if (
      (a.section ?? "") !== (b.section ?? "") ||
      (a.section_singer ?? "") !== (b.section_singer ?? "")
    )
      add("Sections");
    if (
      a.opposite !== b.opposite ||
      a.sung_by !== b.sung_by ||
      voicedWords(a) !== voicedWords(b)
    )
      add("Singers");
    const split = (line: Line) =>
      line.words.map((word) => word.text.trim()).join("|");
    if (split(a) !== split(b)) add("Syllables");
    else if (
      moved(a.start_ms, b.start_ms) ||
      moved(a.end_ms, b.end_ms) ||
      a.words.some(
        (word, at) =>
          moved(word.start_ms, b.words[at].start_ms) ||
          moved(word.end_ms, b.words[at].end_ms),
      )
    )
      add("Timing");
    if (a.translation.trim() !== b.translation.trim()) add("Translations");
    if (a.romanization.trim() !== b.romanization.trim()) add("Romanization");
  }
  while (i < base.length) unmatched(base[i++]);
  while (j < head.length) unmatched(head[j++]);
  return EDIT_KINDS.filter((kind) => counts.has(kind)).map((kind) => ({
    kind,
    lines: counts.get(kind)!,
  }));
}
