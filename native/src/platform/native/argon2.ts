import { argon2 } from 'react-native-quick-crypto';

export interface Argon2idInput { password: Uint8Array; salt: Uint8Array; memoryKiB: number; iterations: number; parallelism: number; length: number; secret?: Uint8Array; associatedData?: Uint8Array }

/** Argon2id v1.3 in native code (OpenSSL via react-native-quick-crypto), off the JS thread. */
export function argon2idNative(input: Argon2idInput): Promise<Uint8Array> {
  return new Promise((resolve, reject) => argon2('argon2id', {
    message: input.password, nonce: input.salt, memory: input.memoryKiB, passes: input.iterations,
    parallelism: input.parallelism, tagLength: input.length,
    ...(input.secret ? { secret: input.secret } : {}), ...(input.associatedData ? { associatedData: input.associatedData } : {}),
  }, (error, result) => error ? reject(error) : resolve(new Uint8Array(result.buffer, result.byteOffset, result.byteLength).slice())));
}
