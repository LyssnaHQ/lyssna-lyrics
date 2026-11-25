export const SPECTRUM_WINDOW_SIZE: number;
export function spectrumFrequency(position: number): number;
export function spectrumFrequencyPosition(hz: number): number;
export function createSpectrumAnalyser(sampleRate: number, rows: number): (
  left: Float32Array, right: Float32Array, center: number, output: Float32Array, offset?: number, mask?: number,
) => void;
export function spectrumLevel(amplitude: number): number;
export function spectrumAmplitude(level: number): number;
