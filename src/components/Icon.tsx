/**
 * The handful of line icons the chrome uses, drawn inline so there is no icon
 * font or sprite request on first paint. Always decorative: every control that
 * shows one carries its own text label.
 */

const PATHS = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4.35-4.35',
  close: 'M6 6l12 12M18 6 6 18',
  filter: 'M4 6h16M7 12h10M10 18h4',
  arrange: 'M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  check: 'M5 12.5 10 17l9-10',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
  asc: 'M12 19V5M6 11l6-6 6 6',
  desc: 'M12 5v14M6 13l6 6 6-6',
  barcode: 'M4 6v12M7 6v12M10 6v12M14 6v12M17 6v12M20 6v12',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
