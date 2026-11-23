import { expect, test } from '@playwright/test';
import { activeBlocks, blocksOf, blockText } from '../../src/domain/block-list';
import { contrastRatio, luminance, over, parseColor } from '../../src/utils/core/colors';

test.describe('Umbraco block lists', () => {
  const raw = {
    layout: { 'Umbraco.BlockList': [{ contentKey: 'b' }, { contentKey: 'a' }, { contentKey: 'c' }] },
    contentData: [
      { key: 'a', values: [{ alias: 'title', culture: 'en-US', value: ' First ' }, { alias: 'title', culture: 'ar-EG', value: 'الأول' }, { alias: 'isActive', culture: null, value: true }] },
      { key: 'b', values: [{ alias: 'title', culture: null, value: 'Shared' }, { alias: 'isActive', culture: null, value: false }] },
      { key: 'c', values: [{ alias: 'title', culture: 'en-US', value: 'Third' }] },
    ],
  };

  test('blocks come in the editor\'s order, each field in the language asked for', () => {
    expect(blocksOf(raw, 'en-US').map((block) => blockText(block, 'title'))).toEqual(['Shared', 'First', 'Third']);
    expect(blocksOf(raw, 'ar-EG').map((block) => blockText(block, 'title'))).toEqual(['Shared', 'الأول', '']);
  });

  test('only switched-on blocks are active; a block without the switch counts as on', () => {
    expect(activeBlocks(blocksOf(raw, 'en-US')).map((block) => blockText(block, 'title'))).toEqual(['First', 'Third']);
    expect(blocksOf(undefined, 'en-US')).toEqual([]);
  });
});

test.describe('Colour contrast', () => {
  test('colours are read as the browser reports them', () => {
    expect(parseColor('rgb(255, 255, 255)')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseColor('transparent')).toBeUndefined();
  });

  test('contrast as WCAG measures it', () => {
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const black = { r: 0, g: 0, b: 0, a: 1 };
    expect(contrastRatio(black, white)).toBe(21);
    expect(contrastRatio(white, white)).toBe(1);
    expect(contrastRatio({ r: 118, g: 118, b: 118, a: 1 }, white)).toBeGreaterThanOrEqual(4.5);
    expect(luminance(white)).toBe(1);
    expect(over({ r: 0, g: 0, b: 0, a: 0.5 }, white)).toEqual({ r: 128, g: 128, b: 128, a: 1 });
  });
});
