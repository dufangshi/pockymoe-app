// Stands in for `hash-wasm` in the vendored Web code (accountCrypto.deriveMaster). Hermes
// has no WebAssembly; the same Argon2id runs natively. Only the call shape the Web uses
// (`outputType: 'binary'`) is supported.
import { argon2idNative } from '../native/argon2';

export interface Argon2Options {
  password: string | Uint8Array; salt: string | Uint8Array; secret?: Uint8Array;
  iterations: number; parallelism: number; memorySize: number; hashLength: number; outputType?: 'binary' | 'hex';
}
const bytes = (value: string | Uint8Array) => typeof value === 'string' ? new TextEncoder().encode(value) : value;

export async function argon2id(options: Argon2Options): Promise<Uint8Array> {
  if (options.outputType && options.outputType !== 'binary') throw new Error('Only binary Argon2id output is supported');
  return argon2idNative({
    password: bytes(options.password), salt: bytes(options.salt), memoryKiB: options.memorySize,
    iterations: options.iterations, parallelism: options.parallelism, length: options.hashLength,
    ...(options.secret ? { secret: options.secret } : {}),
  });
}
