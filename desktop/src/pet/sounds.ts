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
/** Decodes whatever the voice service produced; a newer alert cuts off the one being read. */
export async function playSpeech(audio: Uint8Array): Promise<void> {
  context ??= new AudioContext();
  if (context.state !== 'running') await context.resume();
  const copy = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
  const buffer = await context.decodeAudioData(copy);
  speech?.stop();
  const source = context.createBufferSource();
  source.buffer = buffer; source.connect(context.destination); source.start();
  speech = source;
  source.onended = () => { if (speech === source) speech = null; };
}
