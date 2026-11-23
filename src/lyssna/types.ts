export interface Word {
  romanization?: string;
  start_ms: number;
  end_ms: number;
  text: string;
  /** Timing estimated by experimental word sync, not authored. */
  estimated?: boolean;
  sung_by?: "first" | "second" | "third";
}
export interface Line {
  start_ms: number;
  end_ms: number;
  text: string;
  translation: string;
  romanization: string;
  /** Romanized reading shown under the line, timed like the line. */
  reading?: Line;
  words: Word[];
  background: boolean;
  opposite: boolean;
  sung_by?: "second" | "third";
  section?: string;
  section_singer?: string;
}
export interface LyssnaContributor {
  user_id?: string;
  username?: string;
  avatar_url?: string;
  share: number;
}
export interface AppleOriginal {
  apple_id: string;
  sha256: string;
  isrc: string;
  timing_kind?: "word";
}
export interface Lyrics {
  appleOriginal?: AppleOriginal;
  lyssna?: { songId: string; contributors: LyssnaContributor[] };
  songwriters?: string[];
  attribution?: { uploader?: Contributor; maker?: Contributor };
  lines: Line[];
  source: string;
  /** Attribution text supplied by the lyrics provider. */
  credit?: string;
  instrumental: boolean;
  synced: boolean;
  /** Timing advertised by the lyrics provider. */
  timing_kind?: "word" | "line" | "static";
  /** Word timing was estimated (experimental word sync). */
  estimated_words?: boolean;
  /** Merged Apple Music words were split by experimental word sync. */
  split_words?: boolean;
  /** Line boundaries were estimated from static text and track duration. */
  estimated_lines?: boolean;
}
export interface Contributor {
  id: string;
  username: string;
  /** Discord username from the public profile, if it differs. */
  discord?: string;
  url?: string;
  avatar?: string;
  hasProfileBanner?: boolean;
}
