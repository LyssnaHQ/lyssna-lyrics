export interface Word {
  romanization?: string;
  start_ms: number;
  end_ms: number;
  text: string;
  /** Timing estimated by experimental word sync, not authored. */
  estimated?: boolean;
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
}
export interface LyssnaContributor {
  user_id?: string;
  username?: string;
  avatar_url?: string;
  share: number;
}
export interface Lyrics {
  lyssna?: { songId: string; contributors: LyssnaContributor[] };
  songwriters?: string[];
  attribution?: { uploader?: Contributor; maker?: Contributor };
  lines: Line[];
  source: string;
  instrumental: boolean;
  synced: boolean;
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
