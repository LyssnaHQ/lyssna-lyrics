import { createContext, useContext, useEffect, useState } from "react";
import type { RecordingFormat } from "./recording-export";
import type { SpotifyCapture } from "./spotify-capture";

export type RecordingStatus = {
  percent: number;
  sharing: boolean;
  deleting: boolean;
  message?: string;
  start?(): void;
  stop?(): void;
  returnToSpotify?(): void;
  remove(): Promise<void>;
  exportAudio(format: RecordingFormat): Promise<void>;
};

export type CreatorEnvironmentValue = {
  root: HTMLElement;
  portal: HTMLElement;
  view: Window & typeof globalThis;
  read: (at?: number) => number;
  capture: SpotifyCapture;
  recording?: RecordingStatus;
  playingFullRecording: boolean;
  replayAvailable: boolean;
  replayCaptured: (rate: number) => void;
  spectrumKey: string;
  spectrumAudioUri?: string;
  openAudio: () => void;
  manageStoredData(trigger: HTMLElement | null): void;
  waveform: (uri: string, buckets: number) => Promise<Uint8Array>;
  spectrogram: (uri: string, from: number, to: number, columns: number, rows: number, signal: AbortSignal) => Promise<Uint16Array>;
  playClip: (uri: string, start: number, end: number) => void;
};

export const CreatorEnvironment = createContext<CreatorEnvironmentValue>(null!);
export const useCreatorEnvironment = () => useContext(CreatorEnvironment);

export const IS_MAC = /Mac/i.test(navigator.platform);
export const MODIFIER = IS_MAC ? "Cmd" : "Ctrl";

export function useCreatorClock(playing: boolean, enabled = true) {
  const { view, read } = useCreatorEnvironment();
  const [position, setPosition] = useState(read);
  useEffect(() => {
    if (!enabled) return;
    if (!playing) {
      const update = () => setPosition(read());
      update();
      const timer = view.setInterval(update, 100);
      return () => view.clearInterval(timer);
    }
    let frame = 0;
    let last = 0;
    const tick = (time: number) => {
      if (time - last >= 16) {
        last = time;
        setPosition(read());
      }
      frame = view.requestAnimationFrame(tick);
    };
    tick(view.performance.now());
    return () => view.cancelAnimationFrame(frame);
  }, [playing, enabled, view, read]);
  return { position, read };
}
