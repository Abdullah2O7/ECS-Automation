/**
 * Colours as the browser reports them (`rgb(r, g, b)` / `rgba(r, g, b, a)`) and the contrast between two of them, as the
 * accessibility guidelines (WCAG 2) measure it: 1 (none) to 21 (black on white). Text is readable from 4.5 (3 for large text).
 */

export type Rgb = { r: number; g: number; b: number; a: number };

/** A colour from `rgb(...)` / `rgba(...)`; undefined for anything else. */
export const parseColor = (css: string): Rgb | undefined => {
  const parts = /^rgba?\(([^)]+)\)$/.exec(css.trim())?.[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (!parts || parts.length < 3 || parts.some((part) => Number.isNaN(part))) {
    return undefined;
  }
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
};

/** How light a colour looks, from 0 (black) to 1 (white). */
export const luminance = ({ r, g, b }: Rgb): number => {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/** The contrast between two colours, from 1 to 21. */
export const contrastRatio = (first: Rgb, second: Rgb): number => {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
};

/** A colour with some transparency, as it looks over a solid background. */
export const over = (top: Rgb, background: Rgb): Rgb => ({
  r: Math.round(top.r * top.a + background.r * (1 - top.a)),
  g: Math.round(top.g * top.a + background.g * (1 - top.a)),
  b: Math.round(top.b * top.a + background.b * (1 - top.a)),
  a: 1,
});
