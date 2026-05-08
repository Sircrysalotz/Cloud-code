/**
 * Pure-JS PNG encoder — no dependencies.
 *
 * Encodes an RGBA pixel buffer to a PNG file as a Uint8Array.
 * Supports only RGBA (color type 6), 8-bit depth — exactly what we need
 * for sprite sheet export.
 *
 * Based on the PNG spec (RFC 2083). Uses raw deflate via zlib-compatible
 * implementation. No external deps required.
 */

// ── Adler-32 checksum ─────────────────────────────────────────────────────────
function adler32(data) {
  let s1 = 1, s2 = 0;
  for (let i = 0; i < data.length; i++) {
    s1 = (s1 + data[i]) % 65521;
    s2 = (s2 + s1)      % 65521;
  }
  return (s2 << 16) | s1;
}

// ── CRC-32 for PNG chunks ─────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(data, start = 0, end = data.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

// ── Deflate (uncompressed blocks, store method) ───────────────────────────────
// We use DEFLATE store blocks (type 00) — no compression, but valid PNG.
// For sprites at 64x64, uncompressed is fine and keeps the encoder simple.
function deflateStore(data) {
  const BLOCK = 65535;
  const blocks = Math.ceil(data.length / BLOCK) || 1;
  const out = [];

  // zlib header: CM=8, CINFO=7 (window size 32KB), FCHECK
  out.push(0x78, 0x01); // zlib deflate header (level 1)

  let pos = 0;
  for (let i = 0; i < blocks; i++) {
    const isLast = (i === blocks - 1) ? 1 : 0;
    const blockData = data.subarray(pos, pos + BLOCK);
    const len = blockData.length;
    const nlen = (~len) & 0xffff;

    out.push(isLast);                        // BFINAL, BTYPE=00
    out.push(len & 0xff, (len >> 8) & 0xff); // LEN
    out.push(nlen & 0xff, (nlen >> 8) & 0xff); // NLEN
    for (let j = 0; j < len; j++) out.push(blockData[j]);
    pos += BLOCK;
  }

  // Adler-32 checksum (big-endian)
  const a = adler32(data);
  out.push((a >>> 24) & 0xff, (a >>> 16) & 0xff, (a >>> 8) & 0xff, a & 0xff);

  return new Uint8Array(out);
}

// ── PNG chunk builder ─────────────────────────────────────────────────────────
function chunk(type, data) {
  const typeBytes = type.split('').map(c => c.charCodeAt(0));
  const len = data.length;
  const buf = new Uint8Array(4 + 4 + len + 4);
  let i = 0;
  // Length (big-endian)
  buf[i++] = (len >>> 24) & 0xff;
  buf[i++] = (len >>> 16) & 0xff;
  buf[i++] = (len >>>  8) & 0xff;
  buf[i++] =  len         & 0xff;
  // Type
  typeBytes.forEach(b => buf[i++] = b);
  // Data
  data.forEach(b => buf[i++] = b);
  // CRC (over type + data)
  const c = crc32(buf, 4, 4 + 4 + len);
  buf[i++] = (c >>> 24) & 0xff;
  buf[i++] = (c >>> 16) & 0xff;
  buf[i++] = (c >>>  8) & 0xff;
  buf[i++] =  c         & 0xff;
  return buf;
}

// ── Main encoder ──────────────────────────────────────────────────────────────
/**
 * Encode an RGBA pixel buffer to PNG bytes.
 * @param {Uint8Array|number[]} rgba  flat RGBA array, length = width * height * 4
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array} PNG file bytes
 */
export function encodePNG(rgba, width, height) {
  // PNG signature
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8]  = 8;  // bit depth
  ihdr[9]  = 6;  // color type: RGBA
  ihdr[10] = 0;  // compression method
  ihdr[11] = 0;  // filter method
  ihdr[12] = 0;  // interlace: none
  const ihdrChunk = chunk('IHDR', Array.from(ihdr));

  // IDAT chunk — filter rows then deflate
  // Each row: filter byte (0 = None) + RGBA pixels
  const rowBytes = width * 4;
  const filtered = new Uint8Array(height * (1 + rowBytes));
  for (let r = 0; r < height; r++) {
    const dest = r * (1 + rowBytes);
    filtered[dest] = 0; // filter type: None
    const src = r * rowBytes;
    for (let j = 0; j < rowBytes; j++) filtered[dest + 1 + j] = rgba[src + j];
  }

  const compressed = deflateStore(filtered);
  const idatChunk = chunk('IDAT', Array.from(compressed));

  // IEND chunk
  const iendChunk = chunk('IEND', []);

  // Concatenate
  const total = sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of [sig, ihdrChunk, idatChunk, iendChunk]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}
