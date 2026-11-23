import { expect, test } from '@playwright/test';
import { fileContent, KILOBYTE, MEGABYTE } from '../../src/utils/core/test-files';

test.describe('Test files of an exact size', () => {
  test('a picture or document has exactly the requested size', () => {
    expect(fileContent('jpeg', 300 * KILOBYTE).length).toBe(300 * KILOBYTE);
    expect(fileContent('png', 2 * MEGABYTE + 1).length).toBe(2 * MEGABYTE + 1);
    expect(fileContent('pdf', 5 * MEGABYTE + 1).length).toBe(5 * MEGABYTE + 1);
  });

  test('every format starts with its own signature', () => {
    expect(fileContent('jpeg', 10_000).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(fileContent('png', 10_000).subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(fileContent('gif', 10_000).subarray(0, 3).toString('latin1')).toBe('GIF');
    expect(fileContent('pdf', 10_000).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(fileContent('docx', 10_000).subarray(0, 2).toString('latin1')).toBe('PK');
  });

  test('a picture grown to a size is still a whole picture of its format', () => {
    for (const size of [10_000, 65_540, 300 * KILOBYTE + 3, 2 * MEGABYTE + 1]) {
      const jpeg = fileContent('jpeg', size);
      expect(jpeg.length).toBe(size);
      expect(jpeg.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
      const gif = fileContent('gif', size);
      expect(gif.length).toBe(size);
      expect(gif[gif.length - 1]).toBe(0x3b);
      const png = fileContent('png', size);
      expect(png.length).toBe(size);
      expect(png.subarray(-8, -4).toString('latin1')).toBe('IEND');
    }
  });

  test('a size smaller than the format start gives the bare start', () => {
    expect(fileContent('png', 1).length).toBeGreaterThan(1);
  });
});
