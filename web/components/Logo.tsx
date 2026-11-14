// The MOSAIC logo: an "M" made of rounded diamond tiles in three sage tones, and a thin, wide-tracked wordmark
// (the A has no crossbar). Drawn here as SVG so it is crisp at any size and follows the theme.
// Rebuilt from the supplied design image. To use the original artwork instead, replace TILES / LETTERS below.

/** The tile lattice: [row, column, tone]. Rows are 27px apart; odd rows sit half a step across, so the diamonds interlock. */
export const TILES: [number, number, string][] = [
  [0, 1, "#DCE7DF"], [0, 5, "#EEF3EF"],
  [1, 0, "#3E4F46"], [1, 2, "#3E4F46"], [1, 4, "#3E4F46"], [1, 6, "#86988D"],
  [2, 1, "#E4EBE3"], [2, 3, "#86988D"], [2, 5, "#3E4F46"],
  [3, 0, "#B2C0B7"], [3, 6, "#DCE7DF"],
];
export const MARK_BOX = "-28 -28 218 137"; // viewBox of the mark

/** Just the "M". */
export function LogoMark({ className = "h-6 w-auto", title }: { className?: string; title?: string }) {
  return (
    <svg viewBox={MARK_BOX} className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      {TILES.map(([r, k, c]) => (
        <rect key={`${r}-${k}`} x={-18} y={-18} width={36} height={36} rx={5} fill={c} transform={`translate(${k * 27} ${r * 27}) rotate(45)`} />
      ))}
    </svg>
  );
}

/** The letters M O S A I C, drawn as thin strokes (24 units tall) so they inherit the text colour. */
const LETTERS = [
  "M0 24 V0 L11 15 L22 0 V24", // M
  "M54 12 m-11 0 a11 11 0 1 0 22 0 a11 11 0 1 0 -22 0", // O
  "M110 4 C106 0 94 0 94 6 C94 12 110 12 110 18 C110 24 98 24 94 20", // S
  "M130 24 L141 0 L152 24", // A without a crossbar
  "M173 0 V24", // I
  "M215.5 4.5 A11 11 0 1 0 215.5 19.5", // C
];
export function Letters({ className = "h-[0.9rem] w-auto" }: { className?: string }) {
  return (
    <svg viewBox="-2 -2 224 28" className={className} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="square" strokeLinejoin="miter" aria-hidden>
      {LETTERS.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

/** Mark + wordmark side by side, for the nav and the footer. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <LogoMark className="h-6 w-auto" />
      <Letters />
      <span className="sr-only">MOSAIC</span>
    </span>
  );
}
