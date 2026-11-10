// Campos de distancia con signo (SDF) para modelar anatomía placeholder de forma
// orgánica: primitivas (esferas, elipsoides, conos redondeados, triángulos gruesos)
// unidas con mínimos suaves. Fórmulas de distancia según Inigo Quilez (iquilezles.org).
// Todo en metros. Evaluación monomórfica y sin asignaciones (se llama ~10⁶ veces).

export type V3 = [number, number, number];

export const SPHERE = 0;
export const ELLIPSOID = 1;
export const ROUNDCONE = 2;
export const TRIANGLE = 3;
export const BOX = 4;

export const ADD = 0;
export const SUB = 1;
export const INTER = 2;

export interface Prim {
  kind: number;
  op: number;
  k: number;
  bone: string;
  /** Dirección de fibra (músculos) o eje principal. */
  fx: number; fy: number; fz: number;
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  cx: number; cy: number; cz: number;
  r1: number; r2: number;
  rx: number; ry: number; rz: number;
  /** Matriz mundo→local (filas) para elipsoides/cajas rotadas. */
  m00: number; m01: number; m02: number;
  m10: number; m11: number; m12: number;
  m20: number; m21: number; m22: number;
  /** Esfera envolvente para descartar primitivas lejanas. */
  sx: number; sy: number; sz: number; sr: number;
}

export interface PrimOpts {
  /** Radio del mínimo suave (m). */
  k?: number;
  op?: 'add' | 'sub' | 'int';
  bone?: string;
}

function blank(): Prim {
  return {
    kind: 0, op: ADD, k: 0, bone: '', fx: 0, fy: 1, fz: 0,
    ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, cx: 0, cy: 0, cz: 0, r1: 0, r2: 0, rx: 1, ry: 1, rz: 1,
    m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0, m20: 0, m21: 0, m22: 1,
    sx: 0, sy: 0, sz: 0, sr: 0,
  };
}

// ── utilidades vectoriales mínimas ─────────────────────────────
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => scale(a, 1 / (len(a) || 1));
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mirror = (a: V3): V3 => [-a[0], a[1], a[2]];

/** Matriz de rotación (filas = ejes locales en mundo) desde ángulos de Euler XYZ en grados. */
function eulerRows(rot: V3): [V3, V3, V3] {
  const [x, y, z] = rot.map((d) => (d * Math.PI) / 180);
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  // R = Rz * Ry * Rx ; columnas = ejes locales en mundo.
  const c0: V3 = [cy * cz, cy * sz, -sy];
  const c1: V3 = [sx * sy * cz - cx * sz, sx * sy * sz + cx * cz, sx * cy];
  const c2: V3 = [cx * sy * cz + sx * sz, cx * sy * sz - sx * cz, cx * cy];
  return [c0, c1, c2];
}

export class SDF {
  prims: Prim[] = [];
  /** Si es verdadero se evalúa con |x|: se modela solo la mitad izquierda (+X). */
  symmetric = false;

  private push(p: Prim, o: PrimOpts | undefined): Prim {
    p.k = o?.k ?? 0;
    p.op = o?.op === 'sub' ? SUB : o?.op === 'int' ? INTER : ADD;
    p.bone = o?.bone ?? '';
    this.prims.push(p);
    return p;
  }

  sphere(c: V3, r: number, o?: PrimOpts): Prim {
    const p = blank();
    p.kind = SPHERE;
    [p.ax, p.ay, p.az] = c;
    p.r1 = r;
    [p.sx, p.sy, p.sz] = c;
    p.sr = r;
    return this.push(p, o);
  }

  /** Elipsoide con orientación por Euler (grados) o por ejes explícitos. */
  ellipsoid(c: V3, radii: V3, rot?: V3 | [V3, V3, V3], o?: PrimOpts): Prim {
    const p = blank();
    p.kind = ELLIPSOID;
    [p.ax, p.ay, p.az] = c;
    [p.rx, p.ry, p.rz] = radii;
    const axes = !rot ? null : Array.isArray(rot[0]) ? (rot as [V3, V3, V3]) : eulerRows(rot as V3);
    if (axes) {
      [p.m00, p.m01, p.m02] = axes[0];
      [p.m10, p.m11, p.m12] = axes[1];
      [p.m20, p.m21, p.m22] = axes[2];
    }
    // Fibra = eje más largo.
    const longest = radii[0] >= radii[1] && radii[0] >= radii[2] ? 0 : radii[1] >= radii[2] ? 1 : 2;
    const ax = axes ? axes[longest] : ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as V3[])[longest];
    [p.fx, p.fy, p.fz] = ax;
    [p.sx, p.sy, p.sz] = c;
    p.sr = Math.max(...radii);
    return this.push(p, o);
  }

  /** Elipsoide orientado por un eje principal X y una referencia "arriba". */
  ellipsoidAlong(c: V3, radii: V3, xAxis: V3, upRef: V3, o?: PrimOpts): Prim {
    const x = norm(xAxis);
    let z = cross(x, upRef);
    if (len(z) < 1e-6) z = cross(x, [0, 0, 1]);
    z = norm(z);
    const y = cross(z, x);
    return this.ellipsoid(c, radii, [x, y, z], o);
  }

  /** Cono redondeado de a (radio r1) a b (radio r2). Con r1 = r2 es una cápsula. */
  cone(a: V3, b: V3, r1: number, r2 = r1, o?: PrimOpts): Prim {
    const p = blank();
    p.kind = ROUNDCONE;
    [p.ax, p.ay, p.az] = a;
    [p.bx, p.by, p.bz] = b;
    p.r1 = r1;
    p.r2 = r2;
    const d = norm(sub(b, a));
    [p.fx, p.fy, p.fz] = d;
    const m = lerp3(a, b, 0.5);
    [p.sx, p.sy, p.sz] = m;
    p.sr = len(sub(b, a)) / 2 + Math.max(r1, r2);
    return this.push(p, o);
  }

  /** Cadena de conos por una polilínea con radios interpolados. */
  chain(pts: V3[], radii: number[], o?: PrimOpts): void {
    for (let i = 0; i < pts.length - 1; i++) this.cone(pts[i], pts[i + 1], radii[i], radii[i + 1], o);
  }

  /** Triángulo con grosor (placa redondeada). */
  triangle(a: V3, b: V3, c: V3, thick: number, o?: PrimOpts): Prim {
    const p = blank();
    p.kind = TRIANGLE;
    [p.ax, p.ay, p.az] = a;
    [p.bx, p.by, p.bz] = b;
    [p.cx, p.cy, p.cz] = c;
    p.r1 = thick;
    const m: V3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    [p.sx, p.sy, p.sz] = m;
    p.sr = Math.max(len(sub(a, m)), len(sub(b, m)), len(sub(c, m))) + thick;
    [p.fx, p.fy, p.fz] = norm(sub(b, a));
    return this.push(p, o);
  }

  /** Caja redondeada (semitamaños `half`, radio de borde `round`). */
  box(c: V3, half: V3, round: number, rot?: V3, o?: PrimOpts): Prim {
    const p = blank();
    p.kind = BOX;
    [p.ax, p.ay, p.az] = c;
    [p.rx, p.ry, p.rz] = half;
    p.r1 = round;
    if (rot) {
      const axes = eulerRows(rot);
      [p.m00, p.m01, p.m02] = axes[0];
      [p.m10, p.m11, p.m12] = axes[1];
      [p.m20, p.m21, p.m22] = axes[2];
    }
    [p.sx, p.sy, p.sz] = c;
    p.sr = len(half) + round;
    return this.push(p, o);
  }

  /** Distancia de una primitiva sola. */
  static prim(p: Prim, x: number, y: number, z: number): number {
    switch (p.kind) {
      case SPHERE:
        return Math.sqrt((x - p.ax) ** 2 + (y - p.ay) ** 2 + (z - p.az) ** 2) - p.r1;
      case ELLIPSOID: {
        const dx = x - p.ax, dy = y - p.ay, dz = z - p.az;
        const lx = (dx * p.m00 + dy * p.m01 + dz * p.m02) / p.rx;
        const ly = (dx * p.m10 + dy * p.m11 + dz * p.m12) / p.ry;
        const lz = (dx * p.m20 + dy * p.m21 + dz * p.m22) / p.rz;
        const k0 = Math.sqrt(lx * lx + ly * ly + lz * lz);
        const ux = lx / p.rx, uy = ly / p.ry, uz = lz / p.rz;
        const k1 = Math.sqrt(ux * ux + uy * uy + uz * uz);
        return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(p.rx, p.ry, p.rz);
      }
      case ROUNDCONE: {
        // sdRoundCone(p, a, b, r1, r2) — IQ
        const bax = p.bx - p.ax, bay = p.by - p.ay, baz = p.bz - p.az;
        const l2 = bax * bax + bay * bay + baz * baz;
        const rr = p.r1 - p.r2;
        const a2 = l2 - rr * rr;
        const il2 = 1 / l2;
        const pax = x - p.ax, pay = y - p.ay, paz = z - p.az;
        const yv = pax * bax + pay * bay + paz * baz;
        const zv = yv - l2;
        const qx = pax * l2 - bax * yv, qy = pay * l2 - bay * yv, qz = paz * l2 - baz * yv;
        const x2 = qx * qx + qy * qy + qz * qz;
        const y2 = yv * yv * l2;
        const z2 = zv * zv * l2;
        const kk = Math.sign(rr) * rr * rr * x2;
        if (Math.sign(zv) * a2 * z2 > kk) return Math.sqrt(x2 + z2) * il2 - p.r2;
        if (Math.sign(yv) * a2 * y2 < kk) return Math.sqrt(x2 + y2) * il2 - p.r1;
        return (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - p.r1;
      }
      case TRIANGLE:
        return udTriangle(x, y, z, p) - p.r1;
      case BOX: {
        const dx = x - p.ax, dy = y - p.ay, dz = z - p.az;
        const lx = Math.abs(dx * p.m00 + dy * p.m01 + dz * p.m02) - p.rx;
        const ly = Math.abs(dx * p.m10 + dy * p.m11 + dz * p.m12) - p.ry;
        const lz = Math.abs(dx * p.m20 + dy * p.m21 + dz * p.m22) - p.rz;
        const ox = Math.max(lx, 0), oy = Math.max(ly, 0), oz = Math.max(lz, 0);
        const out = Math.sqrt(ox * ox + oy * oy + oz * oz);
        return out + Math.min(Math.max(lx, ly, lz), 0) - p.r1;
      }
    }
    return 1e9;
  }

  /** Distancia del conjunto (uniones, restas e intersecciones suaves en orden). */
  eval(x: number, y: number, z: number): number {
    if (this.symmetric) x = Math.abs(x);
    const ps = this.prims;
    let d = 1e9;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const k = p.k;
      const ex = x - p.sx, ey = y - p.sy, ez = z - p.sz;
      const lb = Math.sqrt(ex * ex + ey * ey + ez * ez) - p.sr;
      if (p.op === ADD) {
        if (lb >= d + k) continue;
        d = smin(d, SDF.prim(p, x, y, z), k);
      } else if (p.op === SUB) {
        if (lb >= k - d) continue;
        d = smax(d, -SDF.prim(p, x, y, z), k);
      } else {
        d = smax(d, SDF.prim(p, x, y, z), k);
      }
    }
    return d;
  }

  /** Para pesos de skinning: distancia mínima por bone a sus primitivas "add". */
  boneDistances(x: number, y: number, z: number, out: Map<string, number>): void {
    out.clear();
    for (const p of this.prims) {
      if (!p.bone || p.op !== ADD) continue;
      const d = SDF.prim(p, x, y, z);
      const cur = out.get(p.bone);
      if (cur === undefined || d < cur) out.set(p.bone, d);
    }
  }

  /** Dirección de fibra de la primitiva "add" más cercana. */
  nearestFiber(x: number, y: number, z: number): V3 {
    let best = 1e9;
    let f: V3 = [0, 1, 0];
    for (const p of this.prims) {
      if (p.op !== ADD) continue;
      const d = SDF.prim(p, x, y, z);
      if (d < best) {
        best = d;
        f = [p.fx, p.fy, p.fz];
      }
    }
    return f;
  }
}

export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Distancia sin signo a un triángulo (IQ). */
function udTriangle(px: number, py: number, pz: number, t: Prim): number {
  const bax = t.bx - t.ax, bay = t.by - t.ay, baz = t.bz - t.az;
  const cbx = t.cx - t.bx, cby = t.cy - t.by, cbz = t.cz - t.bz;
  const acx = t.ax - t.cx, acy = t.ay - t.cy, acz = t.az - t.cz;
  const pax = px - t.ax, pay = py - t.ay, paz = pz - t.az;
  const pbx = px - t.bx, pby = py - t.by, pbz = pz - t.bz;
  const pcx = px - t.cx, pcy = py - t.cy, pcz = pz - t.cz;
  // normal = ba × ac
  const nx = bay * acz - baz * acy, ny = baz * acx - bax * acz, nz = bax * acy - bay * acx;
  const s1 = Math.sign((bay * nz - baz * ny) * pax + (baz * nx - bax * nz) * pay + (bax * ny - bay * nx) * paz);
  const s2 = Math.sign((cby * nz - cbz * ny) * pbx + (cbz * nx - cbx * nz) * pby + (cbx * ny - cby * nx) * pbz);
  const s3 = Math.sign((acy * nz - acz * ny) * pcx + (acz * nx - acx * nz) * pcy + (acx * ny - acy * nx) * pcz);
  if (s1 + s2 + s3 < 2) {
    const h1 = clamp01((bax * pax + bay * pay + baz * paz) / (bax * bax + bay * bay + baz * baz));
    const h2 = clamp01((cbx * pbx + cby * pby + cbz * pbz) / (cbx * cbx + cby * cby + cbz * cbz));
    const h3 = clamp01((acx * pcx + acy * pcy + acz * pcz) / (acx * acx + acy * acy + acz * acz));
    const d1 = (bax * h1 - pax) ** 2 + (bay * h1 - pay) ** 2 + (baz * h1 - paz) ** 2;
    const d2 = (cbx * h2 - pbx) ** 2 + (cby * h2 - pby) ** 2 + (cbz * h2 - pbz) ** 2;
    const d3 = (acx * h3 - pcx) ** 2 + (acy * h3 - pcy) ** 2 + (acz * h3 - pcz) ** 2;
    return Math.sqrt(Math.min(d1, d2, d3));
  }
  const nd = nx * pax + ny * pay + nz * paz;
  return Math.sqrt((nd * nd) / (nx * nx + ny * ny + nz * nz));
}
