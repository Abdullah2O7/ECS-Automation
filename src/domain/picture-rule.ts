import type { TestFileKind } from '../utils/core/test-files';

/**
 * How the back office handles an uploaded picture, everywhere (an accepted team rule - docs/accepted-differences.md):
 * the server compresses every picture first, then keeps it when it is at most 512 KB, and refuses it otherwise with
 * "Image Too Large: Images must not exceed 512 KB. This file is N KB even after compression." There is no check of the
 * picture's format and no minimum size. A test case that asks for a size, format or minimum-size error checks this rule
 * instead. Pure: no browser.
 *
 * The test pictures (src/utils/core/test-files.ts) are 1x1 pictures grown with comment blocks: a JPEG or PNG compresses to
 * almost nothing whatever its size, while a GIF or BMP stays its size - so the outcome of a test picture is known.
 */
const PICTURE_LIMIT_BYTES = 512 * 1024;

const PICTURES: readonly TestFileKind[] = ['jpeg', 'png', 'gif', 'bmp'];
const COMPRESSIBLE: readonly TestFileKind[] = ['jpeg', 'png'];

export const isPicture = (kind: TestFileKind): boolean => PICTURES.includes(kind);

/** What the back office does with a test picture of this format and size: keeps it, or refuses it as too large. */
export const pictureOutcome = (kind: TestFileKind, size: number): 'kept' | 'refused' => {
  if (!isPicture(kind)) {
    throw new Error(`NOT_A_PICTURE: a ${kind} file is not a picture - the picture rule does not apply to it`);
  }
  return COMPRESSIBLE.includes(kind) || size <= PICTURE_LIMIT_BYTES ? 'kept' : 'refused';
};
