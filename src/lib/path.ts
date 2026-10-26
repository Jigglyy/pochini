import type { PathPoint } from "../types";

// A recorded mouse path, as the backend saves it: model.rs `packed_path`.
// "1:" then URL-safe base64 (no padding) of each point's change from the one
// before (x, y, t) as zigzag LEB128 varints. Read here only to show what a
// step holds; the backend writes it.

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** The points of a packed path (or of a plain list, which older files have).
 *  Empty for none, or for a form this version does not know. */
export function decodePath(path: string | PathPoint[] | undefined): PathPoint[] {
  if (Array.isArray(path)) return path;
  if (!path?.startsWith("1:")) return [];
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const c of path.slice(2)) {
    const v = B64.indexOf(c);
    if (v < 0) return [];
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
      acc &= (1 << bits) - 1;
    }
  }
  let i = 0;
  const next = (): number | null => {
    let v = 0;
    let mul = 1;
    while (i < bytes.length) {
      const b = bytes[i++];
      v += (b & 0x7f) * mul;
      if (!(b & 0x80)) return v % 2 === 0 ? v / 2 : -(v + 1) / 2;
      mul *= 128;
    }
    return null;
  };
  const out: PathPoint[] = [];
  let x = 0;
  let y = 0;
  let t = 0;
  for (;;) {
    const dx = next();
    if (dx === null) return out;
    const dy = next();
    const dt = next();
    if (dy === null || dt === null) return out;
    x += dx;
    y += dy;
    t += dt;
    out.push({ x, y, t });
  }
}
