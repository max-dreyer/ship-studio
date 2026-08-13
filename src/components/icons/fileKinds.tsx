/**
 * One glyph per file kind, for the Code tab's file tree.
 *
 * Colour alone was doing all the work here, which fails exactly where it
 * matters: a long list of same-shaped leaves, scanned quickly, in a palette
 * where several kinds sit close together. Shape is the faster channel.
 *
 * Everything is drawn on a 16-unit grid and rendered at 14px, so the shapes
 * are deliberately blunt — a filigree glyph turns to mush at this size. The
 * language kinds get a filled tile with one letter, which stays legible when
 * a stroked outline would not; the rest get a mark that says what the file is
 * for (angle brackets for markup, braces for data, a play triangle for media).
 *
 * The hue still comes from CSS (`file-tree-icon--<kind>`), and every path uses
 * `currentColor`, so the two channels stay in step.
 *
 * @module components/icons/fileKinds
 */

import type { FileKind } from '../../lib/fileIcons';

interface Props {
  kind: FileKind;
  size?: number;
}

/** Filled tile with a single letter — the language kinds. */
function LetterTile({ letter, size }: { letter: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="currentColor" />
      <text
        x="8"
        y="11.6"
        textAnchor="middle"
        fontSize="9.5"
        fontWeight="700"
        fill="var(--bg-primary)"
        fontFamily="var(--font-mono, monospace)"
      >
        {letter}
      </text>
    </svg>
  );
}

function Stroked({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function FileKindIcon({ kind, size = 14 }: Props) {
  switch (kind) {
    case 'ts':
      return <LetterTile letter="T" size={size} />;
    case 'js':
      return <LetterTile letter="J" size={size} />;
    case 'rust':
      return <LetterTile letter="R" size={size} />;

    case 'style':
      // A hash: the selector character, and unmistakable at this size.
      return (
        <Stroked size={size}>
          <path d="M6 2.5 4.5 13.5M11.5 2.5 10 13.5M2.5 6h11M2 10h11" />
        </Stroked>
      );

    case 'markup':
      return (
        <Stroked size={size}>
          <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />
        </Stroked>
      );

    case 'data':
      return (
        <Stroked size={size}>
          <path d="M6.5 2.5c-2 0-2 2.2-2 3.2S3.8 8 2.8 8c1 0 1.7 1.3 1.7 2.3s0 3.2 2 3.2" />
          <path d="M9.5 2.5c2 0 2 2.2 2 3.2S12.2 8 13.2 8c-1 0-1.7 1.3-1.7 2.3s0 3.2-2 3.2" />
        </Stroked>
      );

    case 'doc':
      // Lines of prose, shortest last — reads as text, not as a list.
      return (
        <Stroked size={size}>
          <path d="M3 4h10M3 7.3h10M3 10.6h7" />
        </Stroked>
      );

    case 'image':
      return (
        <Stroked size={size}>
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
          <circle cx="5.8" cy="6.5" r="1.1" />
          <path d="m2.6 11.4 3.2-3 2.4 2.2 2.3-2.2 3 2.8" />
        </Stroked>
      );

    case 'media':
      return (
        <Stroked size={size}>
          <circle cx="8" cy="8" r="5.8" />
          <path d="M6.6 5.6 11 8l-4.4 2.4z" fill="currentColor" stroke="none" />
        </Stroked>
      );

    case 'font':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
          <text
            x="8"
            y="12.5"
            textAnchor="middle"
            fontSize="12.5"
            fontWeight="600"
            fill="currentColor"
            fontFamily="Georgia, serif"
          >
            A
          </text>
        </svg>
      );

    case 'config':
      return (
        <Stroked size={size}>
          <circle cx="8" cy="8" r="2.2" />
          <path d="M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4" />
        </Stroked>
      );

    case 'lock':
      return (
        <Stroked size={size}>
          <rect x="3.2" y="7" width="9.6" height="6.4" rx="1.4" />
          <path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7" />
        </Stroked>
      );

    case 'shell':
      return (
        <Stroked size={size}>
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
          <path d="m5 6.8 2 1.7-2 1.7M8.6 10.4h2.6" />
        </Stroked>
      );

    case 'plain':
    default:
      // The generic page, with its folded corner.
      return (
        <Stroked size={size}>
          <path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6z" />
          <path d="M9 2v3.2a.8.8 0 0 0 .8.8H13" />
        </Stroked>
      );
  }
}
