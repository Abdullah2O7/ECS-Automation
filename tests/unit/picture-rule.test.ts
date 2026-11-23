import { expect, test } from '@playwright/test';
import { isPicture, pictureOutcome } from '../../src/domain/picture-rule';
import { KILOBYTE, MEGABYTE } from '../../src/utils/core/test-files';

test.describe('The picture rule of the back office', () => {
  test('every picture is compressed, then kept up to 512 KB: any format, no minimum size', () => {
    expect(pictureOutcome('jpeg', 3 * MEGABYTE)).toBe('kept');
    expect(pictureOutcome('png', 600 * KILOBYTE)).toBe('kept');
    expect(pictureOutcome('jpeg', 100 * KILOBYTE)).toBe('kept');
    expect(pictureOutcome('gif', 512 * KILOBYTE)).toBe('kept');
    expect(pictureOutcome('gif', 600 * KILOBYTE)).toBe('refused');
    expect(pictureOutcome('bmp', 513 * KILOBYTE)).toBe('refused');
  });

  test('a document is not a picture', () => {
    expect(isPicture('pdf')).toBe(false);
    expect(() => pictureOutcome('pdf', 10 * KILOBYTE)).toThrow(/NOT_A_PICTURE/);
  });
});
