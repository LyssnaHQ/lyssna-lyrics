import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { frameDue } from "../lyssna/frame-cap";
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

export function useCreatorTick(playing: boolean, enabled: boolean, onPosition: (position: number) => void) {
  const { view, read } = useCreatorEnvironment();
  const callback = useRef(onPosition);
  useLayoutEffect(() => { callback.current = onPosition; });
  useEffect(() => {
    if (!enabled) return;
    const update = () => callback.current(read());
    update();
    if (!playing) {
      const timer = view.setInterval(update, 100);
      return () => view.clearInterval(timer);
    }
    let frame = 0;
    let last = view.performance.now();
    const tick = (time: number) => {
      if (time - last >= 15 && frameDue(last, time)) {
        last = time;
        update();
      }
      frame = view.requestAnimationFrame(tick);
    };
    frame = view.requestAnimationFrame(tick);
    return () => view.cancelAnimationFrame(frame);
  }, [playing, enabled, view, read]);
}

export function useCreatorClock(playing: boolean, offset: number, enabled = true, boundaries?: number[]) {
  const { read } = useCreatorEnvironment();
  const [position, setPosition] = useState(() => read() + offset);
  const last = useRef<{ boundaries: number[]; offset: number; index: number }>(undefined);
  useCreatorTick(playing, enabled, (raw) => {
    const next = raw + offset;
    if (boundaries) {
      let from = 0;
      let to = boundaries.length;
      while (from < to) {
        const middle = (from + to) >>> 1;
        if (boundaries[middle] <= next) from = middle + 1;
        else to = middle;
      }
      const previous = last.current;
      if (previous?.boundaries === boundaries && previous.offset === offset && previous.index === from) return;
      last.current = { boundaries, offset, index: from };
    }
    setPosition(next);
  });
  return position;
}
