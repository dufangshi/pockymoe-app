// Structural EBML only. The native test uses a real generated encoder fixture.
// Structural EBML fixture only: native codec tests generate real video with ffmpeg.
function element(id: string, data: Buffer): Buffer {
  const length = data.length < 127 ? Buffer.from([0x80 | data.length]) : Buffer.from([0x40 | data.length >> 8, data.length & 255]);
  return Buffer.concat([Buffer.from(id, 'hex'), length, data]);
}
const num = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
export function structuralVideo(width = 648, fps = 24): Buffer {
  const e = element, duration = Buffer.alloc(8); duration.writeDoubleBE(2000);
  const entry = Buffer.concat([e('83', num(1)), e('86', Buffer.from('V_VP9')), e('23e383', num(Math.round(1e9 / fps))), e('e0', Buffer.concat([e('b0', num(width)), e('ba', num(702)), e('53c0', num(1))]))]);
  return Buffer.concat([e('1a45dfa3', e('4282', Buffer.from('webm'))), e('18538067', Buffer.concat([e('1549a966', Buffer.concat([e('2ad7b1', num(1e6)), e('4489', duration)])), e('1654ae6b', e('ae', entry)), e('1f43b675', Buffer.concat([e('e7', num(0)), ...Array.from({ length: fps * 2 }, (_, i) => { const b = Buffer.alloc(5); b[0] = 0x81; b.writeInt16BE(Math.round(i * 1000 / fps), 1); b[3] = 0x80; return e('a3', b); })]))]))]);
}
