import type { CSSProperties } from "react";
import { pixelGlyphs, type PixelGlyph } from "./pixel-glyphs";

/**
 * A 16×16 pixel glyph. Decorative by default (hidden beside a visible label);
 * pass `label` when the icon is the only content.
 */
export function PixelIcon({
  name,
  size = 16,
  className = "",
  label,
}: {
  name: PixelGlyph;
  size?: number;
  className?: string;
  label?: string;
}) {
  const glyph: { p: string; s?: string } = pixelGlyphs[name];
  return (
    <svg
      className={`pixel-icon ${className}`}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {glyph.s && <path d={glyph.s} fill="currentColor" opacity={0.45} />}
      <path d={glyph.p} fill="currentColor" />
    </svg>
  );
}

/** Rasterise a palette grid into one crisp SVG path per colour. */
function pixelPaths(rows: string[], palette: Record<string, string>) {
  const paths: Record<string, string> = {};
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      const c = row[x];
      if (!palette[c]) {
        x++;
        continue;
      }
      const start = x;
      while (row[x] === c) x++;
      paths[c] = `${paths[c] ?? ""}M${start} ${y}h${x - start}v1h${start - x}z`;
    }
  });
  return Object.entries(paths).map(([c, d]) => (
    <path key={c} d={d} fill={palette[c]} />
  ));
}

// FNV-1a: a stable, non-cryptographic hash so an identity always draws the same avatar.
function hash(text: string) {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
const hairs = [
  "#2e2a26",
  "#5a3b22",
  "#a8662a",
  "#d9b25c",
  "#8f3424",
  "#cfcabd",
  "#2f6d4a",
  "#3c5d96",
];
const skins = ["#f3d2b3", "#e2b48c", "#c48e64", "#9a6744", "#6f4a31"];
const eyes = ["#1d2a44", "#245e1c", "#5a3a1f", "#1f5f86"];
const backdrops = ["#cfe8b8", "#c9e2f1", "#f3e1b0", "#e7d6ef", "#f2d3c4"];
// Three original hair silhouettes on an 8×8 block face (H hair, S skin,
// E eye, N nose shade, M mouth). Mirrored layouts keep every face balanced.
const faces = [
  [
    "HHHHHHHH",
    "HHHHHHHH",
    "HSSSSSSH",
    "SSSSSSSS",
    "SSESSESS",
    "SSSNNSSS",
    "SSSMMSSS",
    "SSSSSSSS",
  ],
  [
    "HHHHHHHH",
    "HHHHHHHH",
    "HHSSSSHH",
    "HSSSSSSH",
    "HSESSESH",
    "SSSNNSSS",
    "SSMMMMSS",
    "SSSSSSSS",
  ],
  [
    "........",
    "HHHHHHHH",
    "HHHSSHHH",
    "HSSSSSSH",
    "SSESSESS",
    "SSSNNSSS",
    "SSSMMSSS",
    ".SSSSSS.",
  ],
];
const shade = (hex: string, f: number) =>
  `#${[1, 3, 5]
    .map((i) =>
      Math.round(parseInt(hex.slice(i, i + 2), 16) * f)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
/**
 * An original 8×8 block-style face derived from a stable account id, so each
 * player keeps the same avatar. It encodes nothing about the account.
 */
export function BlockAvatar({
  seed,
  size = 72,
  className = "",
}: {
  seed: string;
  size?: number;
  className?: string;
}) {
  const h = hash(seed),
    pick = <T,>(list: T[], shift: number) => list[(h >>> shift) % list.length];
  const skin = pick(skins, 0);
  return (
    <svg
      className={`block-avatar ${className}`}
      viewBox="0 0 8 8"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
      style={{ background: pick(backdrops, 20) } as CSSProperties}
    >
      {pixelPaths(pick(faces, 16), {
        H: pick(hairs, 4),
        S: skin,
        N: shade(skin, 0.86),
        M: shade(skin, 0.68),
        E: pick(eyes, 12),
      })}
    </svg>
  );
}

const island = [
  "........llll............",
  ".......lllLll...........",
  "......llLlllll..........",
  "......lllllLll..........",
  ".......llllll...........",
  ".........tt.............",
  ".........tT.............",
  "..gggggggtTggggggggggg..",
  ".gGgggGgggggggGggggGggg.",
  ".ddddddddddddddddddddddd",
  "..dDdddddDdddddDdddddd..",
  "..ddddDddddddddddDddd...",
  "...sssdddsssddsssdsss...",
  "....ssSsssssSssssss.....",
  ".....sssssSsssss........",
  ".......ssssss...........",
  ".........sss............",
  "..........s.............",
];
/** A small original floating island, drawn from a pixel grid. */
export function PixelIsland({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`pixel-island ${className}`}
      viewBox="0 0 24 18"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {pixelPaths(island, {
        l: "#4f9a2e",
        L: "#3d7d22",
        t: "#8a5c33",
        T: "#6b4424",
        g: "#73bf3f",
        G: "#4f9a2e",
        d: "#8b5a2b",
        D: "#6d4421",
        s: "#9a9a96",
        S: "#73736f",
      })}
    </svg>
  );
}

/**
 * A segmented block meter. Every non-zero amount lights at least one block so
 * small usage never looks like zero; the exact figure is always shown beside it.
 */
export function BlockMeter({
  value,
  max,
  label,
  segments = 12,
  tone = "ok",
}: {
  value: number;
  max: number;
  label: string;
  segments?: number;
  tone?: "ok" | "close" | "over";
}) {
  const percent = max > 0 ? (value / max) * 100 : 0;
  const lit =
    value > 0
      ? Math.min(segments, Math.max(1, Math.round((percent / 100) * segments)))
      : 0;
  return (
    <div
      className={`block-meter ${tone}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, percent)}
      aria-valuetext={`${percent.toFixed(1)}% of allowance`}
    >
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className={i < lit ? "on" : undefined} />
      ))}
    </div>
  );
}
