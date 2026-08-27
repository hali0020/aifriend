import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  AUDIO_DATA_URL_MIME_TYPES,
  IMAGE_DATA_URL_MIME_TYPES,
  MAX_AUDIO_BYTES,
  MAX_IMAGE_BYTES,
  audioUploadFilename,
  parseDataUrl,
  validateAudioInput,
  validateImageInput,
} from "../lib/media-validation.js";

function dataUrl(mime, bytes = Buffer.from([0x52, 0x49, 0x46, 0x46])) {
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function jpeg(width = 3, height = 2) {
  const sof = Buffer.from([
    0xff, 0xc0, 0x00, 0x11, 0x08,
    height >> 8, height & 0xff, width >> 8, width & 0xff,
    0x03,
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x00,
    0x03, 0x11, 0x00,
  ]);
  const sos = Buffer.from([
    0xff, 0xda, 0x00, 0x0c, 0x03,
    0x01, 0x00, 0x02, 0x00, 0x03, 0x00,
    0x00, 0x3f, 0x00,
  ]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    sof,
    sos,
    Buffer.from([0xff, 0xd9]),
  ]);
}

function pngChunk(type, payload = Buffer.alloc(0)) {
  const chunk = Buffer.alloc(12 + payload.length);
  chunk.writeUInt32BE(payload.length, 0);
  chunk.write(type, 4, 4, "ascii");
  payload.copy(chunk, 8);
  // The parser deliberately bounds the CRC field but does not claim to decode
  // pixels or repair a bad checksum. Zero is sufficient for these fixtures.
  return chunk;
}

function png(width = 3, height = 2, extraChunks = []) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    ...extraChunks,
    pngChunk("IDAT"),
    pngChunk("IEND"),
  ]);
}

function webpChunk(type, payload) {
  const chunk = Buffer.alloc(8 + payload.length + (payload.length & 1));
  chunk.write(type, 0, 4, "ascii");
  chunk.writeUInt32LE(payload.length, 4);
  payload.copy(chunk, 8);
  return chunk;
}

function webp(chunks) {
  const contents = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(contents.length + 4, 4);
  header.write("WEBP", 8, 4, "ascii");
  return Buffer.concat([header, contents]);
}

function vp8Payload(width = 3, height = 2) {
  const payload = Buffer.alloc(10);
  payload.set([0x9d, 0x01, 0x2a], 3);
  payload.writeUInt16LE(width, 6);
  payload.writeUInt16LE(height, 8);
  return payload;
}

function vp8lPayload(width = 3, height = 2) {
  const payload = Buffer.alloc(5);
  payload[0] = 0x2f;
  payload.writeUInt32LE((width - 1) | ((height - 1) << 14), 1);
  return payload;
}

function vp8xPayload(width = 3, height = 2, flags = 0) {
  const payload = Buffer.alloc(10);
  payload[0] = flags;
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  return payload;
}

describe("strict Data URL parsing", () => {
  test("accepts a canonical audio Data URL and preserves its exact bytes", () => {
    const source = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0xff]);
    const parsed = parseDataUrl(dataUrl("audio/webm", source), AUDIO_DATA_URL_MIME_TYPES, MAX_AUDIO_BYTES);

    assert.equal(parsed.mime, "audio/webm");
    assert.deepEqual(parsed.bytes, source);
  });

  test("rejects MIME types and MIME parameters outside the exact whitelist", () => {
    assert.throws(
      () => validateAudioInput({ dataUrl: dataUrl("application/octet-stream") }),
      /文件类型不受支持/,
    );
    assert.throws(
      () => validateAudioInput({ dataUrl: dataUrl("audio/webm;charset=utf-8") }),
      /文件类型不受支持/,
    );
    assert.throws(
      () => validateAudioInput({ dataUrl: dataUrl("audio/WEBM") }),
      /文件类型不受支持/,
    );
  });

  test("rejects malformed, unpadded, and non-canonical Base64", () => {
    assert.throws(
      () => validateAudioInput({ dataUrl: "data:audio/webm;base64,Zm9v$" }),
      /文件编码无效/,
    );
    assert.throws(
      () => validateAudioInput({ dataUrl: "data:audio/webm;base64,Zg" }),
      /文件编码无效/,
    );
    assert.throws(
      () => validateAudioInput({ dataUrl: "data:audio/webm;base64,Zh==" }),
      /文件编码无效/,
    );
  });

  test("enforces the shared 10MB audio limit before upload", () => {
    const oversized = Buffer.alloc(MAX_AUDIO_BYTES + 1);
    assert.throws(
      () => validateAudioInput({ dataUrl: dataUrl("audio/ogg", oversized) }),
      /文件超过 10MB/,
    );
  });

  test("remains usable for the existing image validation paths", () => {
    const parsed = parseDataUrl(dataUrl("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xd9])), ["image/jpeg"], 4);
    assert.equal(parsed.mime, "image/jpeg");
    assert.deepEqual(parsed.bytes, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  });
});

describe("server-controlled audio upload filenames", () => {
  test("maps every allowed MIME type to a fixed safe filename", () => {
    assert.deepEqual(
      AUDIO_DATA_URL_MIME_TYPES.map(audioUploadFilename),
      ["voice.webm", "voice.ogg", "voice.wav", "voice.m4a", "voice.mp3"],
    );
  });

  test("ignores a malicious client audio.name", () => {
    const parsed = validateAudioInput({
      dataUrl: dataUrl("audio/mpeg"),
      name: "../../evil.exe\r\nContent-Type: application/x-msdownload",
    });

    assert.equal(parsed.filename, "voice.mp3");
    assert.doesNotMatch(parsed.filename, /[\\/\r\n]/);
  });
});

describe("static image validation", () => {
  test("accepts JPEG, PNG, VP8, VP8L, and extended static WebP dimensions", () => {
    const cases = [
      ["image/jpeg", jpeg(), 3, 2],
      ["image/png", png(), 3, 2],
      ["image/webp", webp([webpChunk("VP8 ", vp8Payload())]), 3, 2],
      ["image/webp", webp([webpChunk("VP8L", vp8lPayload())]), 3, 2],
      [
        "image/webp",
        webp([
          webpChunk("VP8X", vp8xPayload()),
          webpChunk("VP8L", vp8lPayload()),
        ]),
        3,
        2,
      ],
    ];

    for (const [mime, bytes, width, height] of cases) {
      const result = validateImageInput({ dataUrl: dataUrl(mime, bytes) });
      assert.equal(result.mime, mime);
      assert.equal(result.width, width);
      assert.equal(result.height, height);
      assert.deepEqual(result.bytes, bytes);
    }
  });

  test("returns a server-built canonical Data URL and Base64 payload", () => {
    const bytes = png(17, 19);
    const result = validateImageInput({
      dataUrl: dataUrl("image/png", bytes),
      name: "../../untrusted.svg",
    });

    assert.equal(result.base64, bytes.toString("base64"));
    assert.equal(result.dataUrl, `data:image/png;base64,${result.base64}`);
    assert.deepEqual(IMAGE_DATA_URL_MIME_TYPES, ["image/jpeg", "image/png", "image/webp"]);
  });

  test("rejects MIME spoofing even when the declared type is allowed", () => {
    assert.throws(
      () => validateImageInput({ dataUrl: dataUrl("image/jpeg", png()) }),
      /声明类型与实际格式不一致/,
    );
    assert.throws(
      () => validateImageInput({ dataUrl: dataUrl("image/webp", jpeg()) }),
      /声明类型与实际格式不一致/,
    );
  });

  test("rejects truncated and out-of-bounds JPEG, PNG, and WebP structures", () => {
    const truncatedJpeg = jpeg().subarray(0, -2);
    const missingScanJpeg = Buffer.concat([
      jpeg().subarray(0, 21),
      Buffer.from([0xff, 0xd9]),
    ]);
    const badPng = png();
    badPng.writeUInt32BE(0xffffffff, 8);
    const badWebp = webp([webpChunk("VP8L", vp8lPayload())]);
    badWebp.writeUInt32LE(0xffffffff, 16);

    assert.throws(() => validateImageInput(dataUrl("image/jpeg", truncatedJpeg)), /JPEG 图片结构无效/);
    assert.throws(() => validateImageInput(dataUrl("image/jpeg", missingScanJpeg)), /JPEG 图片结构无效/);
    assert.throws(() => validateImageInput(dataUrl("image/png", badPng)), /PNG 图片结构无效/);
    assert.throws(() => validateImageInput(dataUrl("image/webp", badWebp)), /WebP 图片结构无效/);
  });

  test("rejects zero dimensions, oversize headers, and the 8MB byte limit", () => {
    const zeroPng = png();
    zeroPng.writeUInt32BE(0, 16);
    assert.throws(() => validateImageInput(dataUrl("image/png", zeroPng)), /PNG 图片结构无效/);
    assert.throws(() => validateImageInput(dataUrl("image/png", png(4096, 4096))), /1200 万像素/);
    assert.throws(
      () => validateImageInput(dataUrl("image/png", Buffer.alloc(MAX_IMAGE_BYTES + 1))),
      /文件超过 8MB/,
    );
  });

  test("supports stricter limits for game JPEG frames", () => {
    assert.throws(
      () => validateImageInput(dataUrl("image/jpeg", jpeg(2000, 2000)), {
        allowedMimeTypes: ["image/jpeg"],
        maxBytes: 2 * 1024 * 1024,
        maxDimension: 4096,
        maxPixels: 3_000_000,
      }),
      /300 万像素/,
    );
  });

  test("rejects APNG animation chunks", () => {
    const actl = Buffer.alloc(8);
    actl.writeUInt32BE(2, 0);
    actl.writeUInt32BE(0, 4);
    assert.throws(
      () => validateImageInput(dataUrl("image/png", png(3, 2, [pngChunk("acTL", actl)]))),
      /不支持动画 PNG/,
    );
  });

  test("rejects animated WebP chunks and the VP8X animation flag", () => {
    assert.throws(
      () => validateImageInput(dataUrl("image/webp", webp([
        webpChunk("VP8X", vp8xPayload(3, 2, 0x02)),
        webpChunk("VP8L", vp8lPayload()),
      ]))),
      /不支持动画 WebP/,
    );
    assert.throws(
      () => validateImageInput(dataUrl("image/webp", webp([
        webpChunk("ANIM", Buffer.alloc(6)),
      ]))),
      /不支持动画 WebP/,
    );
    assert.throws(
      () => validateImageInput(dataUrl("image/webp", webp([
        webpChunk("ANMF", Buffer.alloc(16)),
      ]))),
      /不支持动画 WebP/,
    );
  });

  test("requires the RIFF length to match the WebP file exactly", () => {
    const bytes = webp([webpChunk("VP8L", vp8lPayload())]);
    bytes.writeUInt32LE(bytes.readUInt32LE(4) - 1, 4);
    assert.throws(
      () => validateImageInput(dataUrl("image/webp", bytes)),
      /WebP 图片结构无效/,
    );
  });
});
