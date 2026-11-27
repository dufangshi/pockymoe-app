// expo-file-system's File for Node tests: a file:// URI or a path read from disk.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export class File {
  constructor(readonly uri: string) {}
  async arrayBuffer() {
    const bytes = readFileSync(this.uri.startsWith('file:') ? fileURLToPath(this.uri) : this.uri);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
}
export const Paths = { cache: '/tmp' };
