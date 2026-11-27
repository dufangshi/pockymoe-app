// multipart/form-data as bytes. The sealed relay transport encrypts a request body, so
// the body must exist as bytes before it is sent (React Native's FormData streams files
// natively and cannot be read back).
import { File } from 'expo-file-system';

export interface MultipartFile { field: string; name: string; type: string; uri: string }
const encoder = new TextEncoder();
const quote = (s: string) => s.replace(/["\r\n]/g, '_');

export async function multipart(fields: [string, string][], files: MultipartFile[]) {
  const boundary = `----pockymoe${globalThis.crypto.randomUUID().replace(/-/g, '')}`;
  const parts: Uint8Array[] = [];
  for (const [name, value] of fields)
    parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${quote(name)}"\r\n\r\n${value}\r\n`));
  for (const file of files) {
    parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${quote(file.field)}"; filename="${quote(file.name)}"\r\nContent-Type: ${file.type}\r\n\r\n`));
    parts.push(new Uint8Array(await new File(file.uri).arrayBuffer()));
    parts.push(encoder.encode('\r\n'));
  }
  parts.push(encoder.encode(`--${boundary}--\r\n`));
  const body = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0; for (const p of parts) { body.set(p, offset); offset += p.length; }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
