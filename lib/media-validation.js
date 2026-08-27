export const AUDIO_DATA_URL_MIME_TYPES = Object.freeze([
  "audio/webm",
  "audio/ogg",
  "audio/wav",
  "audio/mp4",
  "audio/mpeg",
]);

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export const IMAGE_DATA_URL_MIME_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 4096;
export const MAX_IMAGE_PIXELS = 12_000_000;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

const AUDIO_UPLOAD_FILENAMES = Object.freeze({
  "audio/webm": "voice.webm",
  "audio/ogg": "voice.ogg",
  "audio/wav": "voice.wav",
  "audio/mp4": "voice.m4a",
  "audio/mpeg": "voice.mp3",
});

export function parseDataUrl(value, allowedMimeTypes, maxBytes) {
  const match = String(value || "").match(/^data:([^;,]+);base64,(.*)$/);
  if (!match || !allowedMimeTypes.includes(match[1])) {
    throw new Error("文件类型不受支持");
  }

  const encoded = match[2];
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const dataLength = encoded.length - padding;
  if (
    !encoded
    || encoded.length % 4 !== 0
    || (encoded.includes("=") && encoded.indexOf("=") !== dataLength)
  ) {
    throw new Error("文件编码无效");
  }

  const decodedSize = encoded.length / 4 * 3 - padding;
  if (decodedSize > maxBytes) {
    throw new Error(`文件超过 ${Math.round(maxBytes / 1024 / 1024)}MB`);
  }

  for (let index = 0; index < dataLength; index++) {
    const code = encoded.charCodeAt(index);
    const allowed = (code >= 0x41 && code <= 0x5a)
      || (code >= 0x61 && code <= 0x7a)
      || (code >= 0x30 && code <= 0x39)
      || code === 0x2b
      || code === 0x2f;
    if (!allowed) throw new Error("文件编码无效");
  }

  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) {
    throw new Error("文件编码无效");
  }
  return { mime: match[1], bytes };
}

export function audioUploadFilename(mime) {
  const filename = AUDIO_UPLOAD_FILENAMES[mime];
  if (!filename) throw new Error("文件类型不受支持");
  return filename;
}

export function validateAudioInput(audio) {
  const parsed = parseDataUrl(
    audio?.dataUrl,
    AUDIO_DATA_URL_MIME_TYPES,
    MAX_AUDIO_BYTES,
  );
  return {
    ...parsed,
    // Ignore audio.name. Multipart filenames come only from the MIME type
    // that passed the server-side whitelist above.
    filename: audioUploadFilename(parsed.mime),
  };
}

function invalidImage(format, detail = "结构无效") {
  throw new Error(`${format} 图片${detail}`);
}

function readJpegDimensions(bytes) {
  if (
    bytes.length < 4
    || bytes[0] !== 0xff
    || bytes[1] !== 0xd8
    || bytes.at(-2) !== 0xff
    || bytes.at(-1) !== 0xd9
  ) {
    invalidImage("JPEG");
  }

  let offset = 2;
  let dimensions = null;
  let inScan = false;
  let sawScan = false;

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      if (!inScan) invalidImage("JPEG");
      offset += 1;
      continue;
    }

    // JPEG permits 0xff fill bytes before a marker.
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) invalidImage("JPEG");
    const marker = bytes[offset];
    offset += 1;

    if (inScan && marker === 0x00) continue;
    if (marker >= 0xd0 && marker <= 0xd7) {
      if (!inScan) invalidImage("JPEG");
      continue;
    }
    if (marker === 0xd9) {
      if (offset !== bytes.length || !dimensions || !sawScan) invalidImage("JPEG");
      return dimensions;
    }
    if (marker === 0xd8 || marker === 0x00) invalidImage("JPEG");
    if (marker === 0x01) {
      inScan = false;
      continue;
    }

    inScan = false;
    if (offset + 2 > bytes.length) invalidImage("JPEG");
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || length > bytes.length - offset) invalidImage("JPEG");
    const end = offset + length;

    if (JPEG_SOF_MARKERS.has(marker)) {
      if (length < 11) invalidImage("JPEG");
      const precision = bytes[offset + 2];
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      const components = bytes[offset + 7];
      if (
        ![8, 12].includes(precision)
        || components < 1
        || components > 4
        || length !== 8 + 3 * components
        || !width
        || !height
        || dimensions
      ) {
        invalidImage("JPEG");
      }
      dimensions = { width, height };
    } else if (marker === 0xda) {
      if (!dimensions || length < 8) invalidImage("JPEG");
      const components = bytes[offset + 2];
      if (components < 1 || components > 4 || length !== 6 + 2 * components) {
        invalidImage("JPEG");
      }
      inScan = true;
      sawScan = true;
    }

    offset = end;
  }

  invalidImage("JPEG");
}

const PNG_BIT_DEPTHS = Object.freeze({
  0: new Set([1, 2, 4, 8, 16]),
  2: new Set([8, 16]),
  3: new Set([1, 2, 4, 8]),
  4: new Set([8, 16]),
  6: new Set([8, 16]),
});

function readPngDimensions(bytes) {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    invalidImage("PNG");
  }

  let offset = 8;
  let dimensions = null;
  let sawImageData = false;
  let chunkIndex = 0;

  while (offset < bytes.length) {
    if (bytes.length - offset < 12) invalidImage("PNG");
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) invalidImage("PNG");
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    if (![...typeBytes].every(value => (value >= 65 && value <= 90) || (value >= 97 && value <= 122))) {
      invalidImage("PNG");
    }
    const type = typeBytes.toString("ascii");
    const dataOffset = offset + 8;
    const nextOffset = dataOffset + length + 4;

    if (chunkIndex === 0) {
      if (type !== "IHDR" || length !== 13) invalidImage("PNG");
      const width = bytes.readUInt32BE(dataOffset);
      const height = bytes.readUInt32BE(dataOffset + 4);
      const bitDepth = bytes[dataOffset + 8];
      const colorType = bytes[dataOffset + 9];
      const compression = bytes[dataOffset + 10];
      const filter = bytes[dataOffset + 11];
      const interlace = bytes[dataOffset + 12];
      if (
        !width
        || !height
        || !PNG_BIT_DEPTHS[colorType]?.has(bitDepth)
        || compression !== 0
        || filter !== 0
        || interlace > 1
      ) {
        invalidImage("PNG");
      }
      dimensions = { width, height };
    } else if (type === "IHDR") {
      invalidImage("PNG");
    }

    if (["acTL", "fcTL", "fdAT"].includes(type)) {
      throw new Error("不支持动画 PNG（APNG）");
    }
    if (type === "IDAT") sawImageData = true;
    if (type === "IEND") {
      if (length !== 0 || !dimensions || !sawImageData || nextOffset !== bytes.length) {
        invalidImage("PNG");
      }
      return dimensions;
    }

    offset = nextOffset;
    chunkIndex += 1;
  }

  invalidImage("PNG");
}

function readUInt24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readVp8Dimensions(bytes, offset, length) {
  if (length < 10) invalidImage("WebP");
  const frameTag = readUInt24LE(bytes, offset);
  const firstPartitionLength = frameTag >>> 5;
  if (
    (frameTag & 1) !== 0
    || ((frameTag >>> 1) & 7) > 3
    || firstPartitionLength > length - 10
    || bytes[offset + 3] !== 0x9d
    || bytes[offset + 4] !== 0x01
    || bytes[offset + 5] !== 0x2a
  ) {
    invalidImage("WebP");
  }
  const width = bytes.readUInt16LE(offset + 6) & 0x3fff;
  const height = bytes.readUInt16LE(offset + 8) & 0x3fff;
  if (!width || !height) invalidImage("WebP");
  return { width, height };
}

function readVp8lDimensions(bytes, offset, length) {
  if (length < 5 || bytes[offset] !== 0x2f) invalidImage("WebP");
  const bits = bytes.readUInt32LE(offset + 1);
  if ((bits >>> 29) !== 0) invalidImage("WebP");
  return {
    width: (bits & 0x3fff) + 1,
    height: ((bits >>> 14) & 0x3fff) + 1,
  };
}

function readVp8xDimensions(bytes, offset, length) {
  if (
    length !== 10
    || (bytes[offset] & 0xc1) !== 0
    || bytes[offset + 1] !== 0
    || bytes[offset + 2] !== 0
    || bytes[offset + 3] !== 0
  ) {
    invalidImage("WebP");
  }
  if ((bytes[offset] & 0x02) !== 0) throw new Error("不支持动画 WebP");
  return {
    width: readUInt24LE(bytes, offset + 4) + 1,
    height: readUInt24LE(bytes, offset + 7) + 1,
  };
}

function readWebpDimensions(bytes) {
  if (
    bytes.length < 12
    || bytes.toString("ascii", 0, 4) !== "RIFF"
    || bytes.toString("ascii", 8, 12) !== "WEBP"
    || bytes.readUInt32LE(4) !== bytes.length - 8
  ) {
    invalidImage("WebP");
  }

  let offset = 12;
  let chunkIndex = 0;
  let extendedDimensions = null;
  let payloadDimensions = null;

  while (offset < bytes.length) {
    if (bytes.length - offset < 8) invalidImage("WebP");
    const type = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (length > bytes.length - dataOffset) invalidImage("WebP");
    const dataEnd = dataOffset + length;
    const nextOffset = dataEnd + (length & 1);
    if (nextOffset > bytes.length) invalidImage("WebP");

    if (type === "ANIM" || type === "ANMF") throw new Error("不支持动画 WebP");
    if (type === "VP8X") {
      if (chunkIndex !== 0 || extendedDimensions) invalidImage("WebP");
      extendedDimensions = readVp8xDimensions(bytes, dataOffset, length);
    } else if (type === "VP8 " || type === "VP8L") {
      if (payloadDimensions) invalidImage("WebP");
      payloadDimensions = type === "VP8 "
        ? readVp8Dimensions(bytes, dataOffset, length)
        : readVp8lDimensions(bytes, dataOffset, length);
    }

    offset = nextOffset;
    chunkIndex += 1;
  }

  if (!payloadDimensions) invalidImage("WebP");
  if (
    extendedDimensions
    && (
      extendedDimensions.width !== payloadDimensions.width
      || extendedDimensions.height !== payloadDimensions.height
    )
  ) {
    invalidImage("WebP");
  }
  return extendedDimensions || payloadDimensions;
}

function detectImageMime(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (
    bytes.length >= 12
    && bytes.toString("ascii", 0, 4) === "RIFF"
    && bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return "";
}

function validateImageDimensions(dimensions, maxDimension, maxPixels) {
  const { width, height } = dimensions;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("图片尺寸无效");
  }
  if (
    width > maxDimension
    || height > maxDimension
    || width > Math.floor(maxPixels / height)
  ) {
    throw new Error(`图片像素过大（上限 ${Math.round(maxPixels / 10_000)} 万像素，单边 ${maxDimension}）`);
  }
}

/**
 * Parses an untrusted image upload and returns the only representation that
 * downstream code may use. This validates the declared MIME type, actual file
 * signature, bounded container structure, static dimensions and upload limits.
 */
export function validateImageInput(image, options = {}) {
  const allowedMimeTypes = options.allowedMimeTypes || IMAGE_DATA_URL_MIME_TYPES;
  const maxBytes = options.maxBytes ?? MAX_IMAGE_BYTES;
  const maxDimension = options.maxDimension ?? MAX_IMAGE_DIMENSION;
  const maxPixels = options.maxPixels ?? MAX_IMAGE_PIXELS;
  const value = typeof image === "string" ? image : image?.dataUrl;
  const parsed = parseDataUrl(value, allowedMimeTypes, maxBytes);
  const actualMime = detectImageMime(parsed.bytes);
  if (actualMime !== parsed.mime) {
    throw new Error("图片声明类型与实际格式不一致");
  }

  const dimensions = parsed.mime === "image/jpeg"
    ? readJpegDimensions(parsed.bytes)
    : parsed.mime === "image/png"
      ? readPngDimensions(parsed.bytes)
      : readWebpDimensions(parsed.bytes);
  validateImageDimensions(dimensions, maxDimension, maxPixels);

  const base64 = parsed.bytes.toString("base64");
  return {
    ...parsed,
    ...dimensions,
    base64,
    dataUrl: `data:${parsed.mime};base64,${base64}`,
  };
}
