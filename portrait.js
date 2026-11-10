const JPEG_PREFIX = 'data:image/jpeg;base64,';
const MAX_DATA_URL_LENGTH = 100_000;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_DIMENSION = 10_000;
const MAX_PIXELS = 24_000_000;
const PORTRAIT_WIDTH = 300;
const PORTRAIT_HEIGHT = 400;
const PORTRAIT_RATIO = PORTRAIT_WIDTH / PORTRAIT_HEIGHT;

function matches(bytes, offset, text) {
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function jpegDimensions(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = view.getUint16(offset);
    if (length < 2 || length > bytes.length - offset) return null;
    const frame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (frame && length >= 8) {
      return {width: view.getUint16(offset + 5), height: view.getUint16(offset + 3)};
    }
    offset += length;
  }
  return null;
}

function webpDimensions(bytes, view) {
  if (bytes.length < 20 || !matches(bytes, 0, 'RIFF') || !matches(bytes, 8, 'WEBP')) return null;
  const riffEnd = view.getUint32(4, true) + 8;
  const length = view.getUint32(16, true);
  if (riffEnd > bytes.length || 20 + length > riffEnd) return null;
  if (matches(bytes, 12, 'VP8X') && length >= 10) {
    const size = offset => 1 + bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16);
    return {width: size(24), height: size(27)};
  }
  if (matches(bytes, 12, 'VP8L') && length >= 5 && bytes[20] === 0x2f) {
    const size = view.getUint32(21, true);
    return {width: (size & 0x3fff) + 1, height: ((size >>> 14) & 0x3fff) + 1};
  }
  if (matches(bytes, 12, 'VP8 ') && length >= 10 && matches(bytes, 23, '\x9d\x01\x2a')) {
    return {width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff};
  }
  return null;
}

function inspectRaster(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const size = jpegDimensions(bytes);
    return size && {...size, type: 'image/jpeg'};
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 33 && matches(bytes, 0, '\x89PNG\r\n\x1a\n')
      && view.getUint32(8) === 13 && matches(bytes, 12, 'IHDR')) {
    return {width: view.getUint32(16), height: view.getUint32(20), type: 'image/png'};
  }
  const size = webpDimensions(bytes, view);
  return size && {...size, type: 'image/webp'};
}

function checkDimensions(width, height) {
  if (!width || !height) throw new Error('This portrait has an invalid image size.');
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    throw new Error('This portrait is too large. Choose an image of up to 24 megapixels and 10,000 pixels per side.');
  }
}

async function decodeRaster(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return {image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close()};
    } catch {
      // The browser may support this format through Image only.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    return {image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url)};
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('This portrait could not be opened. Choose a readable JPEG, PNG, or WebP image.');
  }
}

function encodePortrait(image, width, height) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', {alpha: false});
  if (!context) throw new Error('This browser could not resize the portrait.');
  const cropWidth = Math.min(width, height * PORTRAIT_RATIO);
  const cropHeight = Math.min(height, width / PORTRAIT_RATIO);
  for (const size of [1, 0.75, 0.5]) {
    canvas.width = PORTRAIT_WIDTH * size;
    canvas.height = PORTRAIT_HEIGHT * size;
    context.fillStyle = '#101216';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, (width - cropWidth) / 2, (height - cropHeight) / 2,
      cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.88, 0.8, 0.72, 0.62, 0.52, 0.42]) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (validatePortrait(dataUrl)) return dataUrl;
    }
  }
  throw new Error('This browser could not make a small enough JPEG portrait.');
}

export async function normalizePortrait(file) {
  if (!file?.size) throw new Error('Choose a JPEG, PNG, or WebP portrait.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('This portrait exceeds the 12 MB upload limit.');
  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new Error('This portrait file could not be read.');
  }
  const info = inspectRaster(bytes);
  if (!info) throw new Error('Choose a readable JPEG, PNG, or WebP portrait.');
  checkDimensions(info.width, info.height);
  const decoded = await decodeRaster(new Blob([bytes], {type: info.type}));
  try {
    checkDimensions(decoded.width, decoded.height);
    return encodePortrait(decoded.image, decoded.width, decoded.height);
  } finally {
    decoded.release();
  }
}

export function validatePortrait(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > MAX_DATA_URL_LENGTH || !dataUrl.startsWith(JPEG_PREFIX)) {
    return false;
  }
  const base64 = dataUrl.slice(JPEG_PREFIX.length);
  if (base64.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return false;
  try {
    const decoded = atob(base64);
    if (btoa(decoded) !== base64 || decoded.charCodeAt(decoded.length - 2) !== 0xff
        || decoded.charCodeAt(decoded.length - 1) !== 0xd9) return false;
    const size = jpegDimensions(Uint8Array.from(decoded, char => char.charCodeAt(0)));
    return !!size && size.width > 0 && size.height > 0
      && size.width <= PORTRAIT_WIDTH && size.height <= PORTRAIT_HEIGHT
      && size.width * PORTRAIT_HEIGHT === size.height * PORTRAIT_WIDTH;
  } catch {
    return false;
  }
}
