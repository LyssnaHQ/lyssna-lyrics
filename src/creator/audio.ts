import type { Host } from "../host";
import { spotifySongKey } from "../spotify-song";

const analysisLevel = (db = -60) => Math.min(1, Math.max(0, (db + 55) / 55));
export const pitchBands = 12;
const lowFrequency = 40;
const highFrequency = 20_000;
const frequencyRatio = highFrequency / lowFrequency;
export const spectrumFrequency = (position: number) => lowFrequency * frequencyRatio ** position;
export const spectrumFrequencyPosition = (hz: number) => Math.log(hz / lowFrequency) / Math.log(frequencyRatio);

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

function spectrumWindow(fftSize: number) {
  const taper = Float32Array.from({ length: fftSize }, (_, i) => 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1))));
  const reversed = Uint16Array.from({ length: fftSize }, (_, index) => {
    let value = 0;
    for (let bit = 1; bit < fftSize; bit *= 2) {
      value = (value << 1) | (index & 1);
      index >>= 1;
    }
    return value;
  });
  const cosine = Float32Array.from({ length: fftSize / 2 }, (_, i) => Math.cos(-2 * Math.PI * i / fftSize));
  const sine = Float32Array.from({ length: fftSize / 2 }, (_, i) => Math.sin(-2 * Math.PI * i / fftSize));
  return { fftSize, taper, reversed, cosine, sine };
}

const bassWindow = spectrumWindow(4096);
const transientWindow = spectrumWindow(1024);

function spectrumBand(window: typeof bassWindow, sampleRate: number, rows: number, firstRow: number, endRow: number) {
  const { fftSize, taper, reversed, cosine, sine } = window;
  const real = new Float32Array(fftSize);
  const imaginary = new Float32Array(fftSize);
  const binEdges = Float32Array.from({ length: endRow - firstRow + 1 }, (_, edge) =>
    Math.min(fftSize / 2 - 1, spectrumFrequency(1 - (firstRow + edge) / rows) * fftSize / sampleRate));
  const powerAt = (bin: number) => real[bin] ** 2 + imaginary[bin] ** 2;
  return (left: Float32Array, right: Float32Array, at: number, output: Uint16Array, columns: number, column: number) => {
    const start = at - fftSize / 2;
    imaginary.fill(0);
    for (let i = 0; i < fftSize; i++) {
      real[reversed[i]] = ((left[start + i] ?? 0) + (right[start + i] ?? 0)) * taper[i] / 2;
    }
    for (let width = 2; width <= fftSize; width *= 2) {
      const half = width / 2;
      const stride = fftSize / width;
      for (let block = 0; block < fftSize; block += width) {
        for (let i = 0; i < half; i++) {
          const a = block + i;
          const b = a + half;
          const c = cosine[i * stride];
          const s = sine[i * stride];
          const re = c * real[b] - s * imaginary[b];
          const im = s * real[b] + c * imaginary[b];
          real[b] = real[a] - re;
          imaginary[b] = imaginary[a] - im;
          real[a] += re;
          imaginary[a] += im;
        }
      }
    }
    for (let row = firstRow; row < endRow; row++) {
      const low = binEdges[row - firstRow + 1];
      const high = binEdges[row - firstRow];
      let power = 0;
      if (high - low < 1) {
        const center = (low + high) / 2;
        const bin = Math.floor(center);
        const lower = powerAt(bin);
        power = lower + (center - bin) * (powerAt(bin + 1) - lower);
      } else {
        for (let bin = Math.ceil(low); bin <= high; bin++) power = Math.max(power, powerAt(bin));
      }
      const level = Math.log10(1 + Math.sqrt(power) * 2048 / fftSize);
      output[row * columns + column] = Math.min(65535, Math.round(level / 4 * 65535));
    }
  };
}

export async function creatorSpectrum(buffer: AudioBuffer, fromMs: number, toMs: number, columns: number, rows: number, signal: AbortSignal) {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const output = new Uint16Array(columns * rows);
  const split = Math.ceil((1 - spectrumFrequencyPosition(600)) * rows);
  const bass = spectrumBand(bassWindow, buffer.sampleRate, rows, split, rows);
  const transients = spectrumBand(transientWindow, buffer.sampleRate, rows, 0, split);
  for (let column = 0; column < columns; column++) {
    signal.throwIfAborted();
    const time = fromMs + (toMs - fromMs) * (column + 0.5) / columns;
    const sample = Math.round(time * buffer.sampleRate / 1000);
    bass(left, right, sample, output, columns, column);
    transients(left, right, sample, output, columns, column);
    if (column % 12 === 11) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return output;
}
