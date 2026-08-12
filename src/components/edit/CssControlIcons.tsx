/**
 * Glyphs for the CSS panel's segmented controls.
 *
 * Webflow labels these controls with icons rather than words, which is what
 * lets four options fit in one 24px row. These are drawn to the same brief:
 * 16x16, `currentColor`, and legible at that size — not copies of Webflow's
 * artwork.
 *
 * The registry refers to them by name (`icon: 'align-left'`) so it stays plain
 * data with no JSX; `ICONS` is the only place that mapping exists.
 *
 * @module components/edit/CssControlIcons
 */

import type { ReactNode } from 'react';

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {children}
    </svg>
  );
}

/** Horizontal rules of varying length — the shared base of the align icons. */
function Lines({ widths, align }: { widths: number[]; align: 'start' | 'center' | 'end' }) {
  return (
    <Svg>
      {widths.map((w, i) => {
        const y = 3.5 + i * 3;
        const x = align === 'start' ? 2 : align === 'end' ? 14 - w : 8 - w / 2;
        return <rect key={i} x={x} y={y} width={w} height="1" rx="0.5" fill="currentColor" />;
      })}
    </Svg>
  );
}

const CROSS = (
  <Svg>
    <path
      d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </Svg>
);

export const ICONS: Record<string, ReactNode> = {
  none: CROSS,

  // ── text-align ───────────────────────────────────────────────
  'align-left': <Lines widths={[12, 7, 10]} align="start" />,
  'align-center': <Lines widths={[12, 7, 10]} align="center" />,
  'align-right': <Lines widths={[12, 7, 10]} align="end" />,
  'align-justify': <Lines widths={[12, 12, 12]} align="start" />,

  // ── text-decoration ──────────────────────────────────────────
  underline: (
    <Svg>
      <path d="M5 3v4a3 3 0 0 0 6 0V3" stroke="currentColor" strokeWidth="1.2" />
      <rect x="3.5" y="12" width="9" height="1" rx="0.5" fill="currentColor" />
    </Svg>
  ),
  strikethrough: (
    <Svg>
      <path d="M5 4h6M8 4v8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <rect x="3" y="7.5" width="10" height="1" rx="0.5" fill="currentColor" />
    </Svg>
  ),
  overline: (
    <Svg>
      <rect x="3.5" y="3" width="9" height="1" rx="0.5" fill="currentColor" />
      <path d="M5 6.5v4a3 3 0 0 0 6 0v-4" stroke="currentColor" strokeWidth="1.2" />
    </Svg>
  ),

  // ── font-style ───────────────────────────────────────────────
  roman: (
    <Svg>
      <path
        d="M6 4h4M8 4v8M6.5 12h3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </Svg>
  ),
  italic: (
    <Svg>
      <path
        d="M7 4h4M5 12h4M9.5 4 6.5 12"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </Svg>
  ),

  // ── text-transform ───────────────────────────────────────────
  uppercase: (
    <Svg>
      <path
        d="M2.5 12 5 4l2.5 8M3.3 9.5h3.4M9 12l2-8 2 8M9.8 9.5h2.4"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  ),
  capitalize: (
    <Svg>
      <path
        d="M2.5 12 5 4l2.5 8M3.3 9.5h3.4"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="11" cy="10" r="2.3" stroke="currentColor" strokeWidth="1.1" />
      <path d="M13.3 7v5.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </Svg>
  ),
  lowercase: (
    <Svg>
      <circle cx="4.7" cy="10" r="2.3" stroke="currentColor" strokeWidth="1.1" />
      <path d="M7 7.5v5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="11.3" cy="10" r="2.3" stroke="currentColor" strokeWidth="1.1" />
      <path d="M13.6 7.5v5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </Svg>
  ),

  // ── border-style ─────────────────────────────────────────────
  solid: (
    <Svg>
      <rect x="2" y="7.5" width="12" height="1" rx="0.5" fill="currentColor" />
    </Svg>
  ),
  dashed: (
    <Svg>
      {[2, 6.5, 11].map((x) => (
        <rect key={x} x={x} y="7.5" width="3" height="1" rx="0.5" fill="currentColor" />
      ))}
    </Svg>
  ),
  dotted: (
    <Svg>
      {[2.5, 5, 7.5, 10, 12.5].map((x) => (
        <rect key={x} x={x} y="7.5" width="1.2" height="1" rx="0.5" fill="currentColor" />
      ))}
    </Svg>
  ),

  // ── border edges: the box, with the active side solid ────────
  'edge-top': (
    <Svg>
      <rect x="2.5" y="2.5" width="11" height="11" stroke="currentColor" opacity="0.35" />
      <rect x="2" y="2" width="12" height="1.2" fill="currentColor" />
    </Svg>
  ),
  'edge-right': (
    <Svg>
      <rect x="2.5" y="2.5" width="11" height="11" stroke="currentColor" opacity="0.35" />
      <rect x="12.8" y="2" width="1.2" height="12" fill="currentColor" />
    </Svg>
  ),
  'edge-bottom': (
    <Svg>
      <rect x="2.5" y="2.5" width="11" height="11" stroke="currentColor" opacity="0.35" />
      <rect x="2" y="12.8" width="12" height="1.2" fill="currentColor" />
    </Svg>
  ),
  'edge-left': (
    <Svg>
      <rect x="2.5" y="2.5" width="11" height="11" stroke="currentColor" opacity="0.35" />
      <rect x="2" y="2" width="1.2" height="12" fill="currentColor" />
    </Svg>
  ),
  'edge-all': (
    <Svg>
      <rect x="2.6" y="2.6" width="10.8" height="10.8" stroke="currentColor" strokeWidth="1.2" />
    </Svg>
  ),

  // ── radius targets ───────────────────────────────────────────
  'radius-all': (
    <Svg>
      <rect
        x="2.5"
        y="2.5"
        width="11"
        height="11"
        rx="3.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </Svg>
  ),
  'corner-tl': (
    <Svg>
      <rect x="2.5" y="2.5" width="11" height="11" rx="3.5" stroke="currentColor" opacity="0.3" />
      <path d="M2.5 8V6a3.5 3.5 0 0 1 3.5-3.5h2" stroke="currentColor" strokeWidth="1.4" />
    </Svg>
  ),
  'corner-tr': (
    <Svg>
      <rect x="2.5" y="2.5" width="11" height="11" rx="3.5" stroke="currentColor" opacity="0.3" />
      <path d="M8 2.5h2A3.5 3.5 0 0 1 13.5 6v2" stroke="currentColor" strokeWidth="1.4" />
    </Svg>
  ),
  'corner-br': (
    <Svg>
      <rect x="2.5" y="2.5" width="11" height="11" rx="3.5" stroke="currentColor" opacity="0.3" />
      <path d="M13.5 8v2a3.5 3.5 0 0 1-3.5 3.5H8" stroke="currentColor" strokeWidth="1.4" />
    </Svg>
  ),
  'corner-bl': (
    <Svg>
      <rect x="2.5" y="2.5" width="11" height="11" rx="3.5" stroke="currentColor" opacity="0.3" />
      <path d="M8 13.5H6A3.5 3.5 0 0 1 2.5 10V8" stroke="currentColor" strokeWidth="1.4" />
    </Svg>
  ),
};
