import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Small valid files of an exact size, for the upload cases: a picture or a document of a given format and byte size.
 * Each is a real (tiny) file of its format grown to the size the test chose. A picture (JPEG, PNG, GIF) is grown inside the
 * format - comment blocks the format allows - so it stays a valid picture that a server can read; the other formats are
 * padded after their content. Pure functions, no browser.
 */

// 1x1 pictures: whole, valid files of their formats
const JPEG_1X1 = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIU' +
  'FRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEB' +
  'AxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS' +
  '0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKz' +
  'tLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgEC' +
  'BAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpj' +
  'ZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6' +
  '/9oADAMBAAIRAxEAPwDwKiiivzI/uM//2Q==',
  'base64',
);
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);
const GIF_1X1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const BMP_1X1 = Buffer.from('Qk06AAAAAAAAADYAAAAoAAAAAQAAAAEAAAABABgAAAAAAAQAAADEDgAAxA4AAAAAAAAAAAAAHh7IAA==', 'base64');
const PDF_MINIMAL = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 3 3]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

export type TestFileKind = 'jpeg' | 'png' | 'gif' | 'bmp' | 'pdf' | 'docx' | 'xlsx' | 'mp4';

const BASES: Record<TestFileKind, { bytes: Buffer; extension: string }> = {
  jpeg: { bytes: JPEG_1X1, extension: 'jpg' },
  png: { bytes: PNG_1X1, extension: 'png' },
  gif: { bytes: GIF_1X1, extension: 'gif' },
  bmp: { bytes: BMP_1X1, extension: 'bmp' },
  pdf: { bytes: PDF_MINIMAL, extension: 'pdf' },
  docx: { bytes: Buffer.from('PK\u0003\u0004'), extension: 'docx' },
  xlsx: { bytes: Buffer.from('PK\u0003\u0004'), extension: 'xlsx' },
  mp4: { bytes: Buffer.from('\u0000\u0000\u0000\u0018ftypmp42'), extension: 'mp4' },
};

export const KILOBYTE = 1024;
export const MEGABYTE = 1024 * KILOBYTE;

/** The file's content, exactly `size` bytes (never smaller than the format's own tiny file). */
export const fileContent = (kind: TestFileKind, size: number): Buffer => {
  const { bytes } = BASES[kind];
  if (size <= bytes.length) {
    return bytes;
  }
  const grown = GROW[kind]?.(bytes, size - bytes.length);
  return grown ?? Buffer.concat([bytes, Buffer.alloc(size - bytes.length)]);
};

/**
 * Splits `extra` bytes into blocks of `overhead` + 1..`maxData` bytes each, so that they add up exactly; `undefined` when
 * they cannot (too few bytes for one block).
 */
const blockSizes = (extra: number, overhead: number, maxData: number): number[] | undefined => {
  const sizes: number[] = [];
  let left = extra;
  while (left > 0) {
    let block = Math.min(left, overhead + maxData);
    // never leave a remainder too small to be a block of its own
    if (left - block > 0 && left - block <= overhead) {
      block -= overhead + 1;
    }
    if (block <= overhead) {
      return undefined;
    }
    sizes.push(block);
    left -= block;
  }
  return sizes;
};

/** CRC-32 (the PNG chunk checksum). */
const crc32 = (data: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

/** How a picture is grown by `extra` bytes and stays valid; `undefined` when it cannot be grown by exactly that much. */
const GROW: Partial<Record<TestFileKind, (bytes: Buffer, extra: number) => Buffer | undefined>> = {
  // JPEG: comment segments (FF FE, a 2-byte length, the comment) right after the start-of-image marker
  jpeg: (bytes, extra) => {
    const sizes = blockSizes(extra, 4, 65_533);
    if (!sizes) {
      return undefined;
    }
    const comments = sizes.map((block) => {
      const segment = Buffer.alloc(block, 0x20);
      segment.writeUInt16BE(0xfffe, 0);
      segment.writeUInt16BE(block - 2, 2);
      return segment;
    });
    return Buffer.concat([bytes.subarray(0, 2), ...comments, bytes.subarray(2)]);
  },
  // PNG: private ancillary chunks (length, type, data, CRC), which a reader skips, before the closing IEND chunk
  png: (bytes, extra) => {
    const sizes = blockSizes(extra, 12, 1_000_000);
    if (!sizes) {
      return undefined;
    }
    const chunks = sizes.map((block) => {
      const body = Buffer.concat([Buffer.from('auTo', 'latin1'), Buffer.alloc(block - 12, 0x20)]);
      const chunk = Buffer.alloc(block);
      chunk.writeUInt32BE(block - 12, 0);
      body.copy(chunk, 4);
      chunk.writeUInt32BE(crc32(body), block - 4);
      return chunk;
    });
    const end = bytes.length - 12; // IEND: 4 length bytes, the type, 4 CRC bytes
    return Buffer.concat([bytes.subarray(0, end), ...chunks, bytes.subarray(end)]);
  },
  // GIF: one comment extension (21 FE, sub-blocks of up to 255 bytes, 00) before the closing trailer (3B)
  gif: (bytes, extra) => {
    const sizes = extra === 3 ? [] : blockSizes(extra - 3, 1, 255);
    if (extra < 3 || !sizes) {
      return undefined;
    }
    const subBlocks = sizes.map((block) => Buffer.concat([Buffer.from([block - 1]), Buffer.alloc(block - 1, 0x20)]));
    const comment = Buffer.concat([Buffer.from([0x21, 0xfe]), ...subBlocks, Buffer.from([0x00])]);
    return Buffer.concat([bytes.subarray(0, bytes.length - 1), comment, bytes.subarray(bytes.length - 1)]);
  },
};

/** Writes a test file of the given format and size into a folder and returns its path; the name keeps the sheet's meaning. */
export const writeTestFile = (folder: string, name: string, kind: TestFileKind, size: number): string => {
  mkdirSync(folder, { recursive: true });
  const target = path.join(folder, `${name}.${BASES[kind].extension}`);
  writeFileSync(target, fileContent(kind, size));
  return target;
};
