import type { Host } from "../host";
import { spotifySongKey } from "../spotify-song";
import { createSpectrumAnalyser, spectrumLevel } from "./spectrum-analysis.js";

export { spectrumFrequency, spectrumFrequencyPosition } from "./spectrum-analysis.js";

const analysisLevel = (db = -60) => Math.min(1, Math.max(0, (db + 55) / 55));
export const pitchBands = 12;

export async function creatorWaveform(host: Host, uri: string, buckets: number, buffer?: AudioBuffer) {
  const peaks = new Uint8Array(buckets);
  if (buffer) {
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const frames = buffer.length / buckets;
    for (let index = 0; index < buckets; index++) {
      let peak = 0;
      const first = Math.floor(index * frames);
      const last = Math.min(buffer.length, Math.ceil((index + 1) * frames));
      for (const channel of channels) {
        for (let at = first; at < last; at++) peak = Math.max(peak, Math.abs(channel[at]));
      }
      peaks[index] = Math.min(255, Math.round(255 * peak));
      if (index % 128 === 127) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return peaks;
  }
  const key = spotifySongKey(uri);
  const analysis = key ? await host.analysis(key) : undefined;
  const duration = analysis?.track?.duration ?? 0;
  if (!duration) return new Uint8Array();
  for (const segment of analysis?.segments ?? []) {
    const start = Math.max(0, Math.floor(segment.start / duration * buckets));
    const end = Math.min(buckets, Math.ceil((segment.start + segment.duration) / duration * buckets));
    const peak = Math.round(255 * analysisLevel(segment.loudness_max));
    for (let at = start; at < end; at++) peaks[at] = Math.max(peaks[at], peak);
  }
  return peaks;
}

export async function creatorPitchSpectrum(host: Host, uri: string, fromMs: number, toMs: number, columns: number, signal: AbortSignal) {
  const key = spotifySongKey(uri);
  const analysis = key ? await host.analysis(key) : undefined;
  signal.throwIfAborted();
  const segments = analysis?.segments;
  if (!segments?.some((segment) => segment.pitches?.length === pitchBands)) {
    throw new Error("Spotify pitch analysis is unavailable for this track.");
  }

  const data = new Uint16Array(columns * pitchBands);
  const from = fromMs / 1000;
  const to = toMs / 1000;
  const rate = columns / (to - from);
  for (const segment of segments) {
    const end = segment.start + segment.duration;
    if (segment.start >= to || end <= from || segment.pitches?.length !== pitchBands) continue;
    const first = Math.max(0, Math.floor((segment.start - from) * rate));
    const last = Math.min(columns, Math.ceil((end - from) * rate));
    const level = (65535 / 4) * analysisLevel(segment.loudness_max);
    for (let note = 0; note < pitchBands; note++) {
      const strength = Math.round(level * Math.min(1, Math.max(0, segment.pitches[note])));
      const start = (pitchBands - note - 1) * columns;
      for (let at = first; at < last; at++) data[start + at] = Math.max(data[start + at], strength);
    }
  }
  return data;
}

export async function creatorSpectrum(buffer: AudioBuffer, fromMs: number, toMs: number, columns: number, rows: number, signal: AbortSignal) {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const output = new Uint16Array(columns * rows);
  const analyse = createSpectrumAnalyser(buffer.sampleRate, rows);
  const amplitudes = new Float32Array(rows);
  for (let column = 0; column < columns; column++) {
    signal.throwIfAborted();
    const time = fromMs + (toMs - fromMs) * (column + 0.5) / columns;
    const sample = Math.round(time * buffer.sampleRate / 1000);
    analyse(left, right, sample, amplitudes);
    for (let row = 0; row < rows; row++) output[row * columns + column] = spectrumLevel(amplitudes[row]);
    if (column % 12 === 11) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return output;
}
