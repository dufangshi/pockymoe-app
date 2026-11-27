// Node stand-in for the native Argon2id in tests: the Web's own hash-wasm.
import { argon2id } from 'hash-wasm';
import type { Argon2idInput } from '../../src/platform/native/argon2';

export async function argon2idNative(input: Argon2idInput): Promise<Uint8Array> {
  if (input.associatedData) throw new Error('associated data is not supported in the Node stand-in');
  return argon2id({ password: input.password, salt: input.salt, memorySize: input.memoryKiB, iterations: input.iterations,
    parallelism: input.parallelism, hashLength: input.length, outputType: 'binary', ...(input.secret ? { secret: input.secret } : {}) });
}
