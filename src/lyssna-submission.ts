import type { Host, Track } from "./host";
import { hasLyssnaSession, lyssnaAccountRequest } from "./lyssna-account";
import { lyssnaRetryAt } from "./lyssna-api";

export const publishingRoles = ["uploader", "reviewer", "moderator", "admin"];

const submissionErrors: Record<string, string> = {
  unauthorized: "Sign in to Lyssna in Settings to submit lyrics.",
  insufficient_scope: "Sign in to Lyssna again to submit lyrics.",
  unverified: "Confirm your email on lyssna.org before submitting lyrics.",
  pending_exists: "This song already has lyrics waiting for review.",
  own_open_edit: "You already have an open submission for this song.",
  no_changes: "These lyrics match what Lyssna already has.",
  links_conflict: "The track IDs in this file belong to different songs on Lyssna.",
  open_limit: "You’ve reached your limit for open submissions on Lyssna.",
  invalid_ttml: "Lyssna couldn’t read this TTML. Check the file and try again.",
};

export async function submitLyssnaTtml(file: File, track: Track, host: Host, confirmFirstUpload: () => Promise<boolean>) {
  if (!hasLyssnaSession()) throw new Error(submissionErrors.unauthorized);
  if (!/^[A-Za-z0-9]{22}$/.test(track.id)) throw new Error("Only Spotify songs can be submitted to Lyssna.");
  if (!/\.(ttml|xml)$/i.test(file.name)) throw new Error("Choose a TTML or XML lyrics file.");
  if (file.size > 2_000_000) throw new Error("Lyric file exceeds 2 MB.");

  const ttml = await file.text();
  if (!ttml.trim()) throw new Error("The TTML file is empty.");
  const history = await lyssnaAccountRequest("/v1/me/submissions?limit=1").catch(() => undefined);
  if (!hasLyssnaSession()) throw new Error(submissionErrors.unauthorized);
  if (history?.status === 403) throw new Error(submissionErrors.insufficient_scope);
  if (history?.status === 429 || Date.now() < lyssnaRetryAt()) throw new Error("Lyssna is rate limiting uploads. Try again later.");
  const submissions: unknown = history?.ok ? await history.json().catch(() => null) : null;
  if (!Array.isArray(submissions)) throw new Error("Couldn’t check your Lyssna upload history. Try again later.");
  if (submissions.length === 0 && !await confirmFirstUpload()) return;

  const validIsrc = await host.lookupIsrc(track.id, track.isrc).catch(() => undefined);
  const links = validIsrc ? [{ platform: "isrc", external_id: validIsrc }] : [];
  links.push({ platform: "spotify", external_id: track.id });
  const artists = track.artistLinks?.map(({ name }) => name).filter(Boolean);
  const response = await lyssnaAccountRequest("/v1/submissions", {
    ttml, links, title: track.title,
    artists: artists?.length ? artists : [track.artists || track.artist].filter(Boolean),
    album: track.album || undefined,
  }).catch(() => {
    throw new Error("Couldn’t confirm the upload. Check your submissions on Lyssna before trying again.");
  });
  if (!response?.ok) {
    const problem = await response?.json().catch(() => null) as { error?: string; message?: string } | null | undefined;
    const known = problem?.error && Object.hasOwn(submissionErrors, problem.error) && submissionErrors[problem.error];
    if (known) throw new Error(known);
    if (response?.status === 429 || Date.now() < lyssnaRetryAt()) throw new Error("Lyssna is rate limiting uploads. Try again later.");
    if (!hasLyssnaSession()) throw new Error(submissionErrors.unauthorized);
    if (response && response.status >= 500) throw new Error("Couldn’t confirm the upload. Check your submissions on Lyssna before trying again.");
    if (typeof problem?.message === "string" && problem.message.trim() && problem.message.length <= 200) {
      throw new Error(problem.message);
    }
    throw new Error("Couldn’t upload to Lyssna. Try again later.");
  }
  const result = await response.json().catch(() => null) as {
    status?: string; song_id?: string; song_title?: string; kind?: string; head_revision_id?: string;
  } | null;
  const title = typeof result?.song_title === "string" && result.song_title ? result.song_title : track.title || "This song";
  const status = result?.status;
  const message = status === "approved" ? `${title} is live on Lyssna.`
    : status === "pending" ? `${result?.kind === "edit" ? "Your edit to " : ""}${title} is waiting for review on Lyssna.`
    : `${title} was submitted to Lyssna.`;
  const published = result?.song_id && result.head_revision_id ? { songId: result.song_id, revision: result.head_revision_id } : undefined;
  return { approved: status === "approved", published, isrc: validIsrc, message };
}
