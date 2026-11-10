const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const IHDR = 0x49484452;
const IDAT = 0x49444154;
const IEND = 0x49454e44;
const ITXT = 0x69545874;
const MAX_LOADOUT_BYTES = 1_000_000;
const MAX_PNG_BYTES = 64 * 1024 * 1024;
const MAX_CHUNK_BYTES = 0x7fffffff;
const encoder = new TextEncoder();
const keyword = encoder.encode('Risenholm Loadout');
const crcTable = Uint32Array.from({length: 256}, (_, value) => {
  for (let bit = 0; bit < 8; bit++) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

function crc32(bytes, start, end) {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isLoadoutChunk(bytes, start, end) {
  return end > start + keyword.length
    && bytes[start + keyword.length] === 0
    && keyword.every((byte, index) => byte === bytes[start + index]);
}

async function scanPng(blob) {
  if (blob.size > MAX_PNG_BYTES) throw new Error('This PNG exceeds the 64 MB size limit.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!PNG_SIGNATURE.every((byte, index) => byte === bytes[index])) {
    throw new Error('This file is not a PNG.');
  }
  const view = new DataView(bytes.buffer);
  let loadoutChunk;
  let sawImageData = false;
  let offset = PNG_SIGNATURE.length;
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) throw new Error('This PNG has a truncated chunk.');
    const length = view.getUint32(offset);
    if (length > MAX_CHUNK_BYTES || length > bytes.length - offset - 12) {
      throw new Error('This PNG has an invalid chunk length.');
    }
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const end = dataEnd + 4;
    const type = view.getUint32(typeStart);
    for (let i = typeStart; i < dataStart; i++) {
      const letter = bytes[i] | 0x20;
      if (letter < 97 || letter > 122) throw new Error('This PNG has an invalid chunk type.');
    }
    if (view.getUint32(dataEnd) !== crc32(bytes, typeStart, dataEnd)) {
      throw new Error('This PNG is damaged. A chunk checksum does not match.');
    }
    if (offset === PNG_SIGNATURE.length) {
      if (type !== IHDR || length !== 13) throw new Error('This PNG has an invalid image header.');
    } else if (type === IHDR) {
      throw new Error('This PNG has more than one image header.');
    }
    if (type === IDAT) sawImageData = true;
    if (type === ITXT && isLoadoutChunk(bytes, dataStart, dataEnd)) {
      if (loadoutChunk) throw new Error('This PNG contains more than one embedded Risenholm loadout.');
      loadoutChunk = {offset, dataStart, dataEnd, end};
    }
    if (type === IEND) {
      if (length !== 0 || end !== bytes.length || !sawImageData) {
        throw new Error('This PNG has an invalid image ending.');
      }
      return {bytes, loadoutChunk, iendOffset: offset};
    }
    offset = end;
  }
  throw new Error('This PNG is incomplete. The image ending is missing.');
}

function loadoutChunkBytes(text) {
  // iTXt uses a NUL separator, compression flag and method, then two empty NUL-terminated fields.
  const headerLength = keyword.length + 5;
  const dataLength = headerLength + text.length;
  const bytes = new Uint8Array(12 + dataLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, dataLength);
  view.setUint32(4, ITXT);
  bytes.set(keyword, 8);
  bytes.set(text, 8 + headerLength);
  view.setUint32(8 + dataLength, crc32(bytes, 4, 8 + dataLength));
  return bytes;
}

export async function embedLoadoutInPng(blob, payloadObject) {
  const serialized = JSON.stringify(payloadObject);
  if (!serialized?.startsWith('{')) throw new Error('A loadout must be a JSON object.');
  const text = encoder.encode(serialized);
  if (text.length > MAX_LOADOUT_BYTES) throw new Error('This loadout exceeds the 1 MB size limit.');
  const {bytes, loadoutChunk, iendOffset} = await scanPng(blob);
  const chunk = loadoutChunkBytes(text);
  const prefix = loadoutChunk
    ? [bytes.subarray(0, loadoutChunk.offset), bytes.subarray(loadoutChunk.end, iendOffset)]
    : [bytes.subarray(0, iendOffset)];
  const parts = [...prefix, chunk, bytes.subarray(iendOffset)];
  if (parts.reduce((sum, part) => sum + part.length, 0) > MAX_PNG_BYTES) {
    throw new Error('The PNG with its embedded loadout exceeds the 64 MB size limit.');
  }
  return new Blob(parts, {type: 'image/png'});
}

export async function readLoadoutFromPng(blob) {
  const {bytes, loadoutChunk} = await scanPng(blob);
  if (!loadoutChunk) {
    throw new Error('This PNG has no embedded Risenholm loadout. Image apps can remove the loadout when they re-save a PNG. Import the original exported PNG or its JSON backup.');
  }
  const {dataStart, dataEnd} = loadoutChunk;
  const data = bytes.subarray(dataStart, dataEnd);
  const flagIndex = keyword.length + 1;
  if (data[flagIndex] !== 0 || data[flagIndex + 1] !== 0) {
    throw new Error('This PNG uses an unsupported loadout encoding. Import the original exported PNG or its JSON backup.');
  }
  const languageEnd = data.indexOf(0, flagIndex + 2);
  const translatedKeywordEnd = languageEnd < 0 ? -1 : data.indexOf(0, languageEnd + 1);
  if (translatedKeywordEnd < 0) throw new Error('The embedded loadout header is incomplete.');
  const text = data.subarray(translatedKeywordEnd + 1);
  if (text.length > MAX_LOADOUT_BYTES) throw new Error('The embedded loadout exceeds the 1 MB size limit.');
  let loadout;
  try {
    loadout = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(text));
  } catch {
    throw new Error('The embedded loadout is not valid UTF-8 JSON.');
  }
  if (!loadout || typeof loadout !== 'object' || Array.isArray(loadout)) {
    throw new Error('The embedded loadout must be a JSON object.');
  }
  return loadout;
}
