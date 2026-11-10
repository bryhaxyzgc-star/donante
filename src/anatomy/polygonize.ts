// Poligonización de SDF con "Surface Nets" (Gibson 1998; versión de M. Lysenko):
// un vértice por celda con cambio de signo y un quad por arista cruzada. Da mallas
// más limpias que Marching Cubes y sin tablas. Evaluación dispersa: una grilla gruesa
// descarta bloques lejos de la superficie, así solo se evalúa la "cáscara".
import type { V3 } from './sdf.ts';

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export type Field = (x: number, y: number, z: number) => number;

const BLOCK = 4;

export function polygonize(f: Field, min: V3, max: V3, voxel: number): MeshData {
  const ox = min[0] - voxel, oy = min[1] - voxel, oz = min[2] - voxel;
  const nx = Math.ceil((max[0] - min[0]) / voxel) + 3;
  const ny = Math.ceil((max[1] - min[1]) / voxel) + 3;
  const nz = Math.ceil((max[2] - min[2]) / voxel) + 3;
  const sy = nx, sz = nx * ny;
  const N = nx * ny * nz;
  const val = new Float32Array(N).fill(NaN);

  // ── 1. grilla gruesa ────────────────────────────────────────
  const cnx = Math.ceil((nx - 1) / BLOCK) + 1;
  const cny = Math.ceil((ny - 1) / BLOCK) + 1;
  const cnz = Math.ceil((nz - 1) / BLOCK) + 1;
  const coarse = new Float32Array(cnx * cny * cnz);
  for (let k = 0; k < cnz; k++) {
    const gz = Math.min(k * BLOCK, nz - 1);
    for (let j = 0; j < cny; j++) {
      const gy = Math.min(j * BLOCK, ny - 1);
      for (let i = 0; i < cnx; i++) {
        const gx = Math.min(i * BLOCK, nx - 1);
        const v = f(ox + gx * voxel, oy + gy * voxel, oz + gz * voxel);
        coarse[i + j * cnx + k * cnx * cny] = v;
        val[gx + gy * sy + gz * sz] = v;
      }
    }
  }
  const near = BLOCK * voxel * Math.sqrt(3) * 1.25;
  const farSign = new Float32Array(N);
  for (let k = 0; k < cnz - 1; k++) {
    for (let j = 0; j < cny - 1; j++) {
      for (let i = 0; i < cnx - 1; i++) {
        let mn = Infinity;
        let any = 0;
        for (let c = 0; c < 8; c++) {
          const v = coarse[i + (c & 1) + (j + ((c >> 1) & 1)) * cnx + (k + ((c >> 2) & 1)) * cnx * cny];
          if (Math.abs(v) < mn) mn = Math.abs(v);
          if (c === 0) any = v;
        }
        const x0 = i * BLOCK, x1 = Math.min(x0 + BLOCK, nx - 1);
        const y0 = j * BLOCK, y1 = Math.min(y0 + BLOCK, ny - 1);
        const z0 = k * BLOCK, z1 = Math.min(z0 + BLOCK, nz - 1);
        if (mn < near) {
          for (let z = z0; z <= z1; z++)
            for (let y = y0; y <= y1; y++)
              for (let x = x0; x <= x1; x++) {
                const id = x + y * sy + z * sz;
                if (Number.isNaN(val[id])) val[id] = f(ox + x * voxel, oy + y * voxel, oz + z * voxel);
              }
        } else {
          for (let z = z0; z <= z1; z++)
            for (let y = y0; y <= y1; y++)
              for (let x = x0; x <= x1; x++) farSign[x + y * sy + z * sz] = any;
        }
      }
    }
  }
  for (let i = 0; i < N; i++) if (Number.isNaN(val[i])) val[i] = farSign[i] || 1;

  // ── 2. vértices por celda ───────────────────────────────────
  const cell = new Int32Array(N).fill(-1);
  const pos: number[] = [];
  const idx: number[] = [];
  const g = new Float32Array(8);
  const stride = [1, sy, sz];
  const quad = (a: number, b: number, c: number, d: number) => {
    // Diagonal más corta para triangular el quad.
    const d1 = dist2(pos, a, c);
    const d2 = dist2(pos, b, d);
    if (d1 <= d2) idx.push(a, b, c, a, c, d);
    else idx.push(a, b, d, b, c, d);
  };
  const pt = [0, 0, 0];
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const id = i + j * sy + k * sz;
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = val[id + (c & 1) + ((c >> 1) & 1) * sy + ((c >> 2) & 1) * sz];
          g[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 0xff) continue;
        let ax = 0, ay = 0, az = 0, n = 0;
        for (let c = 0; c < 8; c++) {
          for (let b = 0; b < 3; b++) {
            const c2 = c | (1 << b);
            if (c2 === c) continue;
            const v0 = g[c], v1 = g[c2];
            if (v0 < 0 === v1 < 0) continue;
            const t = v0 / (v0 - v1);
            pt[0] = c & 1; pt[1] = (c >> 1) & 1; pt[2] = (c >> 2) & 1;
            pt[b] += t;
            ax += pt[0]; ay += pt[1]; az += pt[2];
            n++;
          }
        }
        cell[id] = pos.length / 3;
        pos.push(ox + (i + ax / n) * voxel, oy + (j + ay / n) * voxel, oz + (k + az / n) * voxel);
        const ijk = [i, j, k];
        for (let a = 0; a < 3; a++) {
          if ((mask & 1) === ((mask >> (1 << a)) & 1)) continue;
          const iu = (a + 1) % 3, iv = (a + 2) % 3;
          if (ijk[iu] === 0 || ijk[iv] === 0) continue;
          const du = stride[iu], dv = stride[iv];
          const c0 = cell[id], c1 = cell[id - du], c2 = cell[id - du - dv], c3 = cell[id - dv];
          if (c1 < 0 || c2 < 0 || c3 < 0) continue;
          if (mask & 1) quad(c0, c1, c2, c3);
          else quad(c0, c3, c2, c1);
        }
      }
    }
  }

  // ── 3. proyección a la superficie y normales por gradiente ──
  const vc = pos.length / 3;
  const positions = new Float32Array(pos);
  const normals = new Float32Array(vc * 3);
  const h = voxel * 0.5;
  for (let v = 0; v < vc; v++) {
    let x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    for (let it = 0; it < 2; it++) {
      const gx = f(x + h, y, z) - f(x - h, y, z);
      const gy = f(x, y + h, z) - f(x, y - h, z);
      const gz = f(x, y, z + h) - f(x, y, z - h);
      const gl = Math.hypot(gx, gy, gz) || 1;
      const nx_ = gx / gl, ny_ = gy / gl, nz_ = gz / gl;
      if (it === 0) {
        const d = Math.max(-voxel, Math.min(voxel, f(x, y, z)));
        x -= nx_ * d; y -= ny_ * d; z -= nz_ * d;
      } else {
        normals[v * 3] = nx_; normals[v * 3 + 1] = ny_; normals[v * 3 + 2] = nz_;
      }
    }
    positions[v * 3] = x; positions[v * 3 + 1] = y; positions[v * 3 + 2] = z;
  }
  const indices = new Uint32Array(idx);
  orientOutward(positions, normals, indices);
  return { positions, normals, indices };
}

/** Normales exactas desde el gradiente del campo (diferencias centrales). */
export function gradientNormals(positions: Float32Array, f: Field, h: number): Float32Array {
  const n = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    const gx = f(x + h, y, z) - f(x - h, y, z);
    const gy = f(x, y + h, z) - f(x, y - h, z);
    const gz = f(x, y, z + h) - f(x, y, z - h);
    const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    n[i] = gx / l; n[i + 1] = gy / l; n[i + 2] = gz / l;
  }
  return n;
}

function dist2(p: number[], a: number, b: number): number {
  const dx = p[a * 3] - p[b * 3], dy = p[a * 3 + 1] - p[b * 3 + 1], dz = p[a * 3 + 2] - p[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}

/** Si la mayoría de los triángulos tiene la normal geométrica opuesta al gradiente, invierte el winding. */
function orientOutward(p: Float32Array, n: Float32Array, idx: Uint32Array): void {
  let score = 0;
  const step = Math.max(1, Math.floor(idx.length / 3 / 400));
  for (let t = 0; t < idx.length / 3; t += step) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    const e1x = p[b * 3] - p[a * 3], e1y = p[b * 3 + 1] - p[a * 3 + 1], e1z = p[b * 3 + 2] - p[a * 3 + 2];
    const e2x = p[c * 3] - p[a * 3], e2y = p[c * 3 + 1] - p[a * 3 + 1], e2z = p[c * 3 + 2] - p[a * 3 + 2];
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    score += Math.sign(fx * n[a * 3] + fy * n[a * 3 + 1] + fz * n[a * 3 + 2]);
  }
  if (score < 0) {
    for (let t = 0; t < idx.length; t += 3) {
      const tmp = idx[t + 1];
      idx[t + 1] = idx[t + 2];
      idx[t + 2] = tmp;
    }
  }
}

/** Refleja una malla en X (lado derecho a partir del izquierdo) corrigiendo el winding. */
export function mirrorMesh(m: MeshData): MeshData {
  const positions = m.positions.slice();
  const normals = m.normals.slice();
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = -positions[i];
    normals[i] = -normals[i];
  }
  const indices = m.indices.slice();
  for (let t = 0; t < indices.length; t += 3) {
    const tmp = indices[t + 1];
    indices[t + 1] = indices[t + 2];
    indices[t + 2] = tmp;
  }
  return { positions, normals, indices };
}

/** Aplica una matriz 4×4 (column-major, como three) a posiciones y normales. */
export function transformMesh(m: MeshData, e: ArrayLike<number>): MeshData {
  const positions = m.positions.slice();
  const normals = m.normals.slice();
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    positions[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    positions[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    positions[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    const nx = normals[i], ny = normals[i + 1], nz = normals[i + 2];
    // Solo rotaciones/traslaciones: la parte 3×3 basta para normales.
    const rx = e[0] * nx + e[4] * ny + e[8] * nz;
    const ry = e[1] * nx + e[5] * ny + e[9] * nz;
    const rz = e[2] * nx + e[6] * ny + e[10] * nz;
    const l = Math.hypot(rx, ry, rz) || 1;
    normals[i] = rx / l; normals[i + 1] = ry / l; normals[i + 2] = rz / l;
  }
  return { positions, normals, indices: m.indices };
}

/** Une varias mallas en una. */
export function mergeMeshes(list: MeshData[]): MeshData {
  let vc = 0, ic = 0;
  for (const m of list) {
    vc += m.positions.length;
    ic += m.indices.length;
  }
  const positions = new Float32Array(vc);
  const normals = new Float32Array(vc);
  const indices = new Uint32Array(ic);
  let vo = 0, io = 0;
  for (const m of list) {
    positions.set(m.positions, vo);
    normals.set(m.normals, vo);
    const base = vo / 3;
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + base;
    vo += m.positions.length;
    io += m.indices.length;
  }
  return { positions, normals, indices };
}
