import type { Contributor, Line, Lyrics, Word } from "./lyssna/types";

// Spicy Lyrics publishable client key for Spotify's desktop origin.
const clientKey = "sl_pk_yloyxlXK4J_GvDICrVYXYI4Ge1fJ_pia4ruzGLpoGQI";
let retryAt = 0;
export const spicyAppleSource = "Apple Music (via Spicy Lyrics)";

type Vocal = {
  Text?: string;
  StartTime?: number;
  EndTime?: number;
  TranslatedText?: string;
  TransliteratedText?: string;
  Syllables?: (Vocal & { IsPartOfWord?: boolean; TransliteratedIsPartOfWord?: boolean })[];
};
type VocalEntry = Vocal & { Type?: string; Lead?: Vocal; Background?: Vocal[]; OppositeAligned?: boolean };
type Payload = Vocal & {
  id?: string;
  source?: string;
  Type?: string;
  Lines?: VocalEntry[];
  Content?: VocalEntry[];
  SongWriters?: (string | { name?: string })[];
  Songwriters?: (string | { name?: string })[];
  UploadAttribution?: { Uploader?: unknown; Maker?: unknown };
  TTMLUploadMetadata?: { Uploader?: unknown; Maker?: unknown };
};

function contributor(value: unknown): Contributor | undefined {
  if (!value || typeof value !== "object") return;
  const person = value as Record<string, unknown>;
  const firstText = (...keys: string[]) => keys.map((key) => person[key]).find((item): item is string => typeof item === "string" && !!item.trim())?.trim();
  const id = firstText("id", "userId", "user_id") ?? "";
  const discord = firstText("discord", "discordUsername", "discord_username", "username");
  const username = firstText("displayName", "display_name", "global_name", "globalName", "username", "name") ?? (id || undefined);
  if (!username) return;
  const profile = firstText("url", "profileUrl", "profile_url");
  const url = profile && /^https:\/\/spicylyrics\.org\//i.test(profile) ? profile
    : /^\d+$/.test(id) ? `https://spicylyrics.org/uid/${id}` : undefined;
  const image = firstText("avatar_url", "avatarUrl", "avatar");
  const avatar = image?.startsWith("https://") ? image : image && /^\d+$/.test(id) && /^(?:a_)?[a-f0-9]+$/i.test(image)
    ? `https://cdn.discordapp.com/avatars/${id}/${image}.webp?size=64` : undefined;
  return { id, username, discord, url, avatar };
}

function normalize(data: Payload): Lyrics | undefined {
  const source = data.source === "spicy_lyrics" ? "Spicy Lyrics"
    : data.source === "apple_music" ? spicyAppleSource
    : data.source === "spotify" ? "Spotify" : "Unknown source";
  const attribution = data.source === "spicy_lyrics" ? {
    maker: contributor(data.UploadAttribution?.Maker) ?? contributor(data.TTMLUploadMetadata?.Maker),
    uploader: contributor(data.UploadAttribution?.Uploader) ?? contributor(data.TTMLUploadMetadata?.Uploader),
  } : undefined;
  if (data.Type === "Instrumental") return { source, attribution, lines: [], synced: false, instrumental: true };
  const lines: Line[] = [];
  const timed = data.Type === "Syllable" || data.Type === "Line";
  const ms = (time = 0) => Number.isFinite(time) ? Math.max(0, Math.round(time * 1000)) : 0;

  function add(vocal: Vocal, entry: VocalEntry, background = false) {
    const syllables = vocal.Syllables ?? [];
    const start = vocal.StartTime ?? entry.StartTime ?? 0;
    const end = vocal.EndTime ?? entry.EndTime ?? start;
    const words: Word[] = syllables.map((part, index) => {
      const previous = syllables[index - 1];
      const space = previous && !previous.IsPartOfWord ? " " : "";
      const readingSpace = previous && !(previous.TransliteratedIsPartOfWord ?? previous.IsPartOfWord) ? " " : "";
      return {
        text: space + (part.Text ?? ""), romanization: part.TransliteratedText ? readingSpace + part.TransliteratedText : undefined,
        start_ms: ms(part.StartTime ?? start), end_ms: ms(part.EndTime ?? end),
      };
    });
    const text = words.length ? words.map((word) => word.text).join("") : (vocal.Text || entry.Text || "");
    if (!text.trim()) return;
    lines.push({
      text, words, background, opposite: !!entry.OppositeAligned, translation: vocal.TranslatedText ?? "", romanization: vocal.TransliteratedText ?? "",
      start_ms: words[0]?.start_ms ?? ms(start),
      end_ms: words.at(-1)?.end_ms ?? ms(end),
    });
  }

  const entries = data.Content ?? data.Lines ?? [];
  const start = (entry: VocalEntry) => entry.StartTime ?? entry.Lead?.StartTime ?? 0;
  for (const entry of timed ? entries.toSorted((left, right) => start(left) - start(right)) : entries) {
    if (entry.Type === "Interlude") continue;
    add(entry.Lead ?? entry, entry);
    for (const vocal of entry.Background ?? []) add(vocal, entry, true);
  }
  if (lines.length) return {
    source, lines, synced: timed, instrumental: false,
    songwriters: (data.SongWriters ?? data.Songwriters)?.flatMap((writer) => typeof writer === "string" ? [writer] : (writer?.name ? [writer.name] : [])),
    attribution,
  };
}

export async function readSpicyLyrics(trackId: string) {
  if (!/^[A-Za-z0-9]{22}$/.test(trackId) || Date.now() < retryAt) return;
  const response = await fetch(`https://api.spicylyrics.org/v1/lyrics/${trackId}`, {
    headers: { Authorization: `Bearer ${clientKey}`, Accept: "application/json" },
    credentials: "omit",
    referrerPolicy: "no-referrer",
    redirect: "error",
    signal: AbortSignal.timeout(7_000),
  });
  if (response.status === 429) {
    const now = Date.now();
    const header = response.headers.get("Retry-After");
    const until = !header ? now + 60_000 : /^\d+$/.test(header) ? now + Number(header) * 1000 : Date.parse(header);
    retryAt = Math.max(retryAt, Number.isFinite(until) && until > now ? until : now + 60_000);
  } else if (response.status === 401 || response.status === 403) {
    retryAt = Math.max(retryAt, Date.now() + 5 * 60_000);
  }
  if (!response.ok) return;
  const { Body, Status } = await response.json() as { Body?: Payload; Status?: number };
  if (Status === 200 && Body?.id === trackId) return normalize(Body);
}
