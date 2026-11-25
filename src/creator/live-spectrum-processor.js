const batchSize = 4;

class LiveSpectrumProcessor extends AudioWorkletProcessor {
  constructor({ processorOptions }) {
    super();
    const { rows, interval } = processorOptions;
    this.hop = sampleRate * interval / 1000;
    this.rows = rows;
    this.analyse = createSpectrumAnalyser(sampleRate, rows);
    this.ring = new Float32Array(SPECTRUM_WINDOW_SIZE);
    this.position = 0;
    this.amplitudes = new Float32Array(rows * batchSize);
    this.count = 0;
    this.replay = new Float32Array(Math.round(sampleRate / 10) * 2);
    this.replayOffset = 0;
    this.enabled = false;
    this.port.onmessage = ({ data }) => {
      this.enabled = data;
      if (!this.enabled) { this.nextSequence = undefined; this.ring.fill(0); }
    };
  }

  sample(sequence) {
    const offset = this.count * this.rows;
    const center = this.position + this.ring.length / 2;
    this.analyse(this.ring, this.ring, center, this.amplitudes, offset, this.ring.length - 1);
    if (++this.count < batchSize) return;
    this.port.postMessage({ first: sequence - batchSize + 1, amplitudes: this.amplitudes }, [this.amplitudes.buffer]);
    this.amplitudes = new Float32Array(this.rows * batchSize);
    this.count = 0;
  }

  process([input = []]) {
    if (!this.enabled) return true;
    const [left, right = left] = input;
    if (!left?.length) return true;
    if (this.nextSequence === undefined || currentFrame !== this.nextBlock) {
      this.nextSequence = Math.ceil((currentFrame + this.ring.length) / this.hop - 0.5);
      this.count = 0;
      this.replayOffset = 0;
    }
    this.nextBlock = currentFrame + left.length;
    let nextFrame = Math.round((this.nextSequence + 0.5) * this.hop);
    for (let i = 0; i < left.length; i++) {
      if (this.replayOffset === 0) this.replayStart = currentFrame + i;
      this.replay[this.replayOffset++] = left[i];
      this.replay[this.replayOffset++] = right[i];
      if (this.replayOffset === this.replay.length) {
        this.port.postMessage({ firstFrame: this.replayStart, samples: this.replay }, [this.replay.buffer]);
        this.replay = new Float32Array(this.replayOffset);
        this.replayOffset = 0;
      }
      this.ring[this.position] = (left[i] + right[i]) / 2;
      this.position = (this.position + 1) & (this.ring.length - 1);
      if (currentFrame + i + 1 < nextFrame) continue;
      this.sample(this.nextSequence++);
      nextFrame = Math.round((this.nextSequence + 0.5) * this.hop);
    }
    return true;
  }
}

registerProcessor("lyssna-live-spectrum", LiveSpectrumProcessor);
