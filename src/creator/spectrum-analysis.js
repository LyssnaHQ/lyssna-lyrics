const lowFrequency = 40;
const frequencyRatio = 20_000 / lowFrequency;
export const spectrumFrequency = (position) => lowFrequency * frequencyRatio ** position;
export const spectrumFrequencyPosition = (hz) => Math.log(hz / lowFrequency) / Math.log(frequencyRatio);

export const SPECTRUM_WINDOW_SIZE = 4096;

function spectrumWindow(size) {
  const taper = Float32Array.from({ length: size }, (_, i) => 0.5 * (1 - Math.cos(2 * Math.PI * i / (size - 1))));
  const reversed = Uint16Array.from({ length: size }, (_, index) => {
    let value = 0;
    for (let bit = 1; bit < size; bit *= 2) {
      value = (value << 1) | (index & 1);
      index >>= 1;
    }
    return value;
  });
  const cosine = Float32Array.from({ length: size / 2 }, (_, i) => Math.cos(-2 * Math.PI * i / size));
  const sine = Float32Array.from({ length: size / 2 }, (_, i) => Math.sin(-2 * Math.PI * i / size));
  return { size, taper, reversed, cosine, sine };
}

const bassWindow = spectrumWindow(SPECTRUM_WINDOW_SIZE);
const transientWindow = spectrumWindow(1024);

function spectrumBand(window, sampleRate, rows, firstRow, endRow) {
  const { size, taper, reversed, cosine, sine } = window;
  const real = new Float32Array(size);
  const imaginary = new Float32Array(size);
  const edges = Float32Array.from({ length: endRow - firstRow + 1 }, (_, edge) =>
    Math.min(size / 2 - 1, spectrumFrequency(1 - (firstRow + edge) / rows) * size / sampleRate));
  const powerAt = (bin) => real[bin] ** 2 + imaginary[bin] ** 2;
  return (left, right, center, output, offset, mask) => {
    const start = center - size / 2;
    imaginary.fill(0);
    for (let i = 0; i < size; i++) {
      const at = (start + i) & mask;
      real[reversed[i]] = ((left[at] ?? 0) + (right[at] ?? 0)) * taper[i] / 2;
    }
    for (let width = 2; width <= size; width *= 2) {
      const half = width / 2;
      const stride = size / width;
      for (let block = 0; block < size; block += width) {
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
      const low = edges[row - firstRow + 1];
      const high = edges[row - firstRow];
      let power = 0;
      if (high - low < 1) {
        const center = (low + high) / 2;
        const bin = Math.floor(center);
        const lower = powerAt(bin);
        power = lower + (center - bin) * (powerAt(bin + 1) - lower);
      } else {
        for (let bin = Math.ceil(low); bin <= high; bin++) power = Math.max(power, powerAt(bin));
      }
      output[offset + row] = Math.sqrt(power) / size;
    }
  };
}

export function createSpectrumAnalyser(sampleRate, rows) {
  const split = Math.ceil((1 - spectrumFrequencyPosition(600)) * rows);
  const bass = spectrumBand(bassWindow, sampleRate, rows, split, rows);
  const transients = spectrumBand(transientWindow, sampleRate, rows, 0, split);
  return (left, right, center, output, offset = 0, mask = -1) => {
    bass(left, right, center, output, offset, mask);
    transients(left, right, center, output, offset, mask);
  };
}

export const spectrumLevel = (amplitude) => Math.min(65535, Math.round(Math.log10(1 + amplitude * 2048) / 4 * 65535));
export const spectrumAmplitude = (level) => (10 ** (level * 4 / 65535) - 1) / 2048;
