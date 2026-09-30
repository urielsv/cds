/**
 * Whether a `#rrggbb` colour is dark enough that text on it should be light.
 *
 * Uses WCAG relative luminance, split at the point where white and near-black
 * text have equal contrast against the colour (~0.18), rather than at 0.5 —
 * mid-tones read better with light text than a naive midpoint suggests.
 * Anything unparseable counts as light, the tile's empty-state colour.
 */
export function isDark(hex: string): boolean {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());
  if (!match) return false;
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => {
    const c = Number.parseInt(part ?? '0', 16) / 255;
    return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  return luminance < 0.18;
}
