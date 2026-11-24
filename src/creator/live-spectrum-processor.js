const batchSize = 2;
const pcm24Scale = 0x800000;
const toPcm24 = (sample) => Math.max(-pcm24Scale, Math.min(pcm24Scale - 1, Math.round(sample * pcm24Scale)));
class SpectrumWindow {
  constructor(size, frequencies) {
    this.size = size;
    this.edges = Float32Array.from(frequencies, hz => Math.min(size / 2 - 1, hz * size / sampleRate));
    this.real = new Float32Array(size);
    this.imaginary = new Float32Array(size);
    this.taper = Float32Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / size));
    this.reversed = Uint16Array.from({ length: size }, (_, i) => {
      let result = 0;
      for (let bit = 1; bit < size; bit *= 2) {
        result = (result << 1) | (i & 1);
        i >>= 1;
      }
      return result;
    });
    this.cosine = Float32Array.from({ length: size / 2 }, (_, i) => Math.cos(-2 * Math.PI * i / size));
    this.sine = Float32Array.from({ length: size / 2 }, (_, i) => Math.sin(-2 * Math.PI * i / size));
  }

  transform(ring, start) {
    const { size, real, imaginary, taper, reversed, cosine, sine } = this;
    const mask = ring.length - 1;
    imaginary.fill(0);
    for (let i = 0; i < size; i++) real[reversed[i]] = ring[(start + i) & mask] * taper[i];
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
  }

  power(bin) {
    return this.real[bin] ** 2 + this.imaginary[bin] ** 2;
  }

  write(decibels, offset, firstRow, lastRow) {
    for (let row = firstRow; row < lastRow; row++) {
      const low = this.edges[row + 1];
      const high = this.edges[row];
      let power = 0;
      if (high - low < 1) {
        const center = (low + high) / 2;
        const bin = Math.floor(center);
        const lower = this.power(bin);
        power = lower + (center - bin) * (this.power(bin + 1) - lower);
      } else {
        for (let bin = Math.ceil(low); bin <= high; bin++) power = Math.max(power, this.power(bin));
      }
      decibels[offset + row] = 10 * Math.log10(power / (this.size * this.size));
    }
  }
}

class LiveSpectrumProcessor extends AudioWorkletProcessor {
  constructor({ processorOptions }) {
    super();
    const { frequencies, interval, fftSize, transientFftSize } = processorOptions;
    this.hop = sampleRate * interval / 1000;
    this.rows = frequencies.length - 1;
    this.split = frequencies.findIndex(hz => hz <= 600);
    this.bass = new SpectrumWindow(fftSize, frequencies);
    this.transients = new SpectrumWindow(transientFftSize, frequencies);
    this.ring = new Float32Array(fftSize);
    this.position = 0;
    this.decibels = new Float32Array(this.rows * batchSize);
    this.count = 0;
    this.replay = new Int32Array(Math.round(sampleRate / 10) * 2);
    this.replayOffset = 0;
    this.enabled = false;
    this.port.onmessage = ({ data }) => {
      this.enabled = data;
      if (!this.enabled) { this.nextSequence = undefined; this.ring.fill(0); }
    };
  }

  sample(sequence) {
    const offset = this.count * this.rows;
    // Both windows share a centre so the bass detail stays aligned with transients.
    this.bass.transform(this.ring, this.position);
    this.bass.write(this.decibels, offset, this.split, this.rows);
    this.transients.transform(this.ring, this.position + (this.bass.size - this.transients.size) / 2);
    this.transients.write(this.decibels, offset, 0, this.split);
    if (++this.count < batchSize) return;
    this.port.postMessage({ first: sequence - batchSize + 1, decibels: this.decibels }, [this.decibels.buffer]);
    this.decibels = new Float32Array(this.rows * batchSize);
    this.count = 0;
  }

  process([input = []]) {
    if (!this.enabled) return true;
    const [left, right = left] = input;
    if (!left?.length) return true;
    if (this.nextSequence === undefined || currentFrame !== this.nextBlock) {
      this.nextSequence = Math.ceil((currentFrame + this.ring.length) / this.hop);
      this.count = 0;
      this.replayOffset = 0;
    }
    this.nextBlock = currentFrame + left.length;
    let nextFrame = Math.round(this.nextSequence * this.hop);
    for (let i = 0; i < left.length; i++) {
      if (this.replayOffset === 0) this.replayStart = currentFrame + i;
      this.replay[this.replayOffset++] = toPcm24(left[i]);
      this.replay[this.replayOffset++] = toPcm24(right[i]);
      if (this.replayOffset === this.replay.length) {
        this.port.postMessage({ firstFrame: this.replayStart, samples: this.replay }, [this.replay.buffer]);
        this.replay = new Int32Array(this.replayOffset);
        this.replayOffset = 0;
      }
      this.ring[this.position] = (left[i] + right[i]) / 2;
      this.position = (this.position + 1) & (this.ring.length - 1);
      if (currentFrame + i + 1 < nextFrame) continue;
      this.sample(this.nextSequence++);
      nextFrame = Math.round(this.nextSequence * this.hop);
    }
    return true;
  }
}

registerProcessor("lyssna-live-spectrum", LiveSpectrumProcessor);
