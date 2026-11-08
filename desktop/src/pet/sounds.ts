export type PetSound = 'click' | 'completed' | 'needsInput' | 'failed';
interface Note { frequency: number; at: number; length: number }
/** Short synthesized cues; each event type has its own contour so it can be told apart without looking. */
export const SOUNDS: Record<PetSound, Note[]> = {
  click: [{ frequency: 740, at: 0, length: .09 }, { frequency: 988, at: .06, length: .12 }],
  completed: [{ frequency: 784, at: 0, length: .16 }, { frequency: 988, at: .1, length: .16 }, { frequency: 1319, at: .2, length: .3 }],
  needsInput: [{ frequency: 1047, at: 0, length: .16 }, { frequency: 1047, at: .2, length: .16 }, { frequency: 1319, at: .4, length: .24 }],
  failed: [{ frequency: 494, at: 0, length: .2 }, { frequency: 370, at: .17, length: .34 }],
};
let context: AudioContext | null = null;
/** Resolves to the context state so callers and tests can see whether audio really started. */
export async function playSound(sound: PetSound, gain = .2): Promise<AudioContextState> {
  context ??= new AudioContext();
  if (context.state !== 'running') await context.resume();
  const start = context.currentTime + .01;
  for (const note of SOUNDS[sound]) {
    const oscillator = context.createOscillator(), overtone = context.createOscillator(), envelope = context.createGain(), soft = context.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = note.frequency;
    overtone.type = 'triangle'; overtone.frequency.value = note.frequency * 2; soft.gain.value = .12;
    envelope.gain.setValueAtTime(.0001, start + note.at);
    envelope.gain.exponentialRampToValueAtTime(gain, start + note.at + .012);
    envelope.gain.exponentialRampToValueAtTime(.0001, start + note.at + note.length);
    oscillator.connect(envelope); overtone.connect(soft).connect(envelope); envelope.connect(context.destination);
    for (const source of [oscillator, overtone]) { source.start(start + note.at); source.stop(start + note.at + note.length + .02); }
  }
  return context.state;
}
let speech: AudioBufferSourceNode | null = null;
let analyser: AnalyserNode | null = null, samples: Float32Array<ArrayBuffer> | null = null;
let envelope = 0, sampledAt = 0, speechRequest = 0;
/** RMS envelope in seconds: a 60 ms attack and 120 ms release. */
export function smoothSpeech(previous: number, rms: number, elapsed: number): number {
  return previous + (rms - previous) * (1 - Math.exp(-Math.max(0, elapsed) / (rms > previous ? .06 : .12)));
}
export function speechPlaying(): boolean { return speech !== null; }
export function speechLevel(now: number): number {
  if (!speech || !analyser || !samples) return 0;
  analyser.getFloatTimeDomainData(samples);
  const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
  envelope = smoothSpeech(envelope, rms, sampledAt ? (now - sampledAt) / 1000 : 0);
  sampledAt = now;
  return Math.min(1, Math.max(0, (envelope - .008) / .065));
}
export function speechMouth(now: number): 0 | 1 | 2 {
  speechLevel(now);
  return !speech || envelope < .018 ? 0 : envelope < .055 ? 1 : 2;
}
/**
 * Decodes whatever the voice service produced; a newer alert cuts off the one being read.
 * @returns whether this audio started. `onEnd` fires when audio that started stops, cut off or not.
 */
export async function playSpeech(audio: Uint8Array, onEnd?: () => void): Promise<boolean> {
  const request = ++speechRequest;
  context ??= new AudioContext();
  if (context.state !== 'running') await context.resume();
  const copy = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
  const buffer = await context.decodeAudioData(copy);
  if (request !== speechRequest) return false;
  speech?.stop();
  analyser?.disconnect();
  analyser = context.createAnalyser(); analyser.fftSize = 512;
  samples = new Float32Array(analyser.fftSize); envelope = 0; sampledAt = 0;
  const source = context.createBufferSource();
  source.buffer = buffer; source.connect(analyser); analyser.connect(context.destination); source.start();
  speech = source;
  source.onended = () => { source.disconnect(); if (speech === source) { speech = null; analyser?.disconnect(); analyser = null; samples = null; envelope = 0; } onEnd?.(); };
  return true;
}
