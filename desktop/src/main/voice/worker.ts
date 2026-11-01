// Runs in a utility process: loading the model takes hundreds of MB and synthesis blocks its thread.
import { cpus } from 'node:os';
import { join } from 'node:path';
import { encodeWav } from './wav';

interface Request { id: number; dir: string; text: string; sid: number; speed: number }
interface Tts { generate(input: { text: string; sid: number; speed: number; enableExternalBuffer: boolean }): { samples: Float32Array; sampleRate: number } }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sherpa = require('sherpa-onnx-node') as { OfflineTts: new (config: unknown) => Tts };
let tts: Tts | null = null;
function load(dir: string): Tts {
  const file = (name: string): string => join(dir, name);
  return tts ??= new sherpa.OfflineTts({
    model: {
      kokoro: { model: file('model.int8.onnx'), voices: file('voices.bin'), tokens: file('tokens.txt'), dictDir: file('dict'), lexicon: `${file('lexicon-us-en.txt')},${file('lexicon-zh.txt')}` },
      numThreads: Math.min(4, Math.max(1, Math.floor(cpus().length / 2))), provider: 'cpu',
    },
    ruleFsts: ['date-zh.fst', 'number-zh.fst', 'phone-zh.fst'].map(file).join(','),
    maxNumSentences: 1,
  });
}
process.parentPort.on('message', ({ data }: { data: Request }) => {
  try {
    const clip = load(data.dir).generate({ text: data.text, sid: data.sid, speed: data.speed, enableExternalBuffer: false });
    process.parentPort.postMessage({ id: data.id, wav: encodeWav(clip.samples, clip.sampleRate) });
  } catch (error) { process.parentPort.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) }); }
});
process.parentPort.postMessage({ ready: true });
