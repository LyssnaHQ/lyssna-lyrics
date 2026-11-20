const fftSize = 4096;
const mask = fftSize - 1;
const batchSize = 2;
const taper = Float32Array.from({ length: fftSize }, (_, i) => {
  const phase = 2 * Math.PI * i / fftSize;
  return 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase);
});
const reversed = Uint16Array.from({ length: fftSize }, (_, i) => {
  let result = 0;
  for (let bit = 1; bit < fftSize; bit *= 2) {
    result = (result << 1) | (i & 1);
    i >>= 1;
  }
  return result;
});
const cosine = Float32Array.from({ length: fftSize / 2 }, (_, i) => Math.cos(-2 * Math.PI * i / fftSize));
const sine = Float32Array.from({ length: fftSize / 2 }, (_, i) => Math.sin(-2 * Math.PI * i / fftSize));

class LiveSpectrumProcessor extends AudioWorkletProcessor {
  constructor({ processorOptions }) {
    super();
    const { frequencies, interval } = processorOptions;
    this.hop = sampleRate * interval / 1000;
    this.edges = Uint16Array.from(frequencies, (hz) => Math.min(fftSize / 2, Math.round(hz * fftSize / sampleRate)));
    this.rows = this.edges.length - 1;
    this.ring = new Float32Array(fftSize);
    this.position = 0;
    this.real = new Float32Array(fftSize);
    this.imaginary = new Float32Array(fftSize);
    this.decibels = new Float32Array(this.rows * batchSize);
    this.count = 0;
  }

  sample(sequence) {
    const { real, imaginary } = this;
    imaginary.fill(0);
    for (let i = 0; i < fftSize; i++) real[reversed[i]] = this.ring[(this.position + i) & mask] * taper[i];
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
    for (let row = 0; row < this.rows; row++) {
      const first = this.edges[row + 1];
      const last = Math.min(fftSize / 2, Math.max(first + 1, this.edges[row]));
      let power = 0;
      for (let bin = first; bin < last; bin++) power = Math.max(power, real[bin] ** 2 + imaginary[bin] ** 2);
      this.decibels[this.count * this.rows + row] = 10 * Math.log10(power / (fftSize * fftSize));
    }
    if (++this.count < batchSize) return;
    this.port.postMessage({ first: sequence - batchSize + 1, decibels: this.decibels }, [this.decibels.buffer]);
    this.decibels = new Float32Array(this.rows * batchSize);
    this.count = 0;
  }

  process([input = []]) {
    const [left, right = left] = input;
    if (!left?.length) return true;
    if (this.nextSequence === undefined || currentFrame !== this.nextBlock) {
      this.nextSequence = Math.ceil((currentFrame + fftSize) / this.hop);
      this.count = 0;
    }
    this.nextBlock = currentFrame + left.length;
    let nextFrame = Math.round(this.nextSequence * this.hop);
    for (let i = 0; i < left.length; i++) {
      this.ring[this.position] = (left[i] + right[i]) / 2;
      this.position = (this.position + 1) & mask;
      if (currentFrame + i + 1 < nextFrame) continue;
      this.sample(this.nextSequence++);
      nextFrame = Math.round(this.nextSequence * this.hop);
    }
    return true;
  }
}

registerProcessor("lyssna-live-spectrum", LiveSpectrumProcessor);
