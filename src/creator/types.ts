export type { Line, Lyrics, Word } from "../lyssna/types";
import type { Track as SpotifyTrack } from "../host";

export type Track = {
  id: string;
  uri: string;
  name: string;
  artists: { name: string }[];
  album: { name?: string; images: { url: string }[] };
  duration_ms: number;
  songwriters?: string[];
  is_local?: boolean;
  spotify?: SpotifyTrack;
};

export type PlayerRequest =
  | { command: "play"; uri?: string }
  | { command: "pause" }
  | { command: "seek"; positionMs: number }
  | { command: "volume"; volume: number };

export type CreatorState = {
  settings: { lyric_offset_ms: number; reduce_motion: boolean };
  playback: { item?: Track; is_playing: boolean; volume: number };
  playback_rate: number;
  speedEnabled: boolean;
  lyrics?: import("../lyssna/types").Lyrics;
  lyrics_uri?: string;
  lyrics_pending: boolean;
};
