// Simplificación de mallas por métricas de error cuádricas (Garland & Heckbert 1997),
// en la variante iterativa por umbral de Sven Forstmann ("Fast Quadric Mesh
// Simplification", MIT). Rápida y sin heap: en cada pasada colapsa las aristas cuyo
// error está bajo un umbral creciente hasta llegar al número de triángulos pedido.
import type { MeshData } from './polygonize.ts';

/** Reduce `mesh` a ~`target` triángulos. Las normales resultantes son de cara promediadas;
 *  conviene recalcularlas con el SDF si existe. */
export function simplifyMesh(mesh: MeshData, target: number, aggressiveness = 7): MeshData {
  const S = 1000; // trabajar en milímetros: el umbral de Forstmann asume unidades ~1
  const nv = mesh.positions.length / 3;
  let nt = mesh.indices.length / 3;
  if (nt <= target) return mesh;

  const vp = new Float64Array(nv * 3);
  for (let i = 0; i < nv * 3; i++) vp[i] = mesh.positions[i] * S;
  const vq = new Float64Array(nv * 10);
  const vtstart = new Int32Array(nv);
  const vtcount = new Int32Array(nv);
  const vborder = new Uint8Array(nv);

  let tv = new Int32Array(mesh.indices);
  let terr = new Float64Array(nt * 4);
  let tdel = new Uint8Array(nt);
  let tdirty = new Uint8Array(nt);
  let tn = new Float64Array(nt * 3);

  let rtid: number[] = [];
  let rtv: number[] = [];

  const vertexError = (q: number, x: number, y: number, z: number) =>
    vq_[q] * x * x + 2 * vq_[q + 1] * x * y + 2 * vq_[q + 2] * x * z + 2 * vq_[q + 3] * x +
    vq_[q + 4] * y * y + 2 * vq_[q + 5] * y * z + 2 * vq_[q + 6] * y + vq_[q + 7] * z * z +
    2 * vq_[q + 8] * z + vq_[q + 9];
  // Cuádrica temporal (suma de dos vértices) en un buffer aparte.
  const vq_ = new Float64Array(10);
  const det = (a11: number, a12: number, a13: number, a21: number, a22: number, a23: number, a31: number, a32: number, a33: number) => {
    const m = vq_;
    return m[a11] * m[a22] * m[a33] + m[a13] * m[a21] * m[a32] + m[a12] * m[a23] * m[a31] -
      m[a13] * m[a22] * m[a31] - m[a11] * m[a23] * m[a32] - m[a12] * m[a21] * m[a33];
  };
  const pr = new Float64Array(3);
  /** Error de colapsar v1-v2 y posición óptima en `pr`. */
  const calcError = (v1: number, v2: number): number => {
    for (let i = 0; i < 10; i++) vq_[i] = vq[v1 * 10 + i] + vq[v2 * 10 + i];
    const border = vborder[v1] & vborder[v2];
    const d = det(0, 1, 2, 1, 4, 5, 2, 5, 7);
    if (d !== 0 && !border) {
      pr[0] = (-1 / d) * det(1, 2, 3, 4, 5, 6, 5, 7, 8);
      pr[1] = (1 / d) * det(0, 2, 3, 1, 5, 6, 2, 7, 8);
      pr[2] = (-1 / d) * det(0, 1, 3, 1, 4, 6, 2, 5, 8);
      return vertexError(0, pr[0], pr[1], pr[2]);
    }
    const x1 = vp[v1 * 3], y1 = vp[v1 * 3 + 1], z1 = vp[v1 * 3 + 2];
    const x2 = vp[v2 * 3], y2 = vp[v2 * 3 + 1], z2 = vp[v2 * 3 + 2];
    const e1 = vertexError(0, x1, y1, z1);
    const e2 = vertexError(0, x2, y2, z2);
    const e3 = vertexError(0, (x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    const e = Math.min(e1, e2, e3);
    if (e === e1) { pr[0] = x1; pr[1] = y1; pr[2] = z1; }
    else if (e === e2) { pr[0] = x2; pr[1] = y2; pr[2] = z2; }
    else { pr[0] = (x1 + x2) / 2; pr[1] = (y1 + y2) / 2; pr[2] = (z1 + z2) / 2; }
    return e;
  };

  const updateMesh = (iteration: number) => {
    if (iteration > 0) {
      let dst = 0;
      for (let i = 0; i < nt; i++) {
        if (tdel[i]) continue;
        tv[dst * 3] = tv[i * 3]; tv[dst * 3 + 1] = tv[i * 3 + 1]; tv[dst * 3 + 2] = tv[i * 3 + 2];
        for (let j = 0; j < 4; j++) terr[dst * 4 + j] = terr[i * 4 + j];
        tn[dst * 3] = tn[i * 3]; tn[dst * 3 + 1] = tn[i * 3 + 1]; tn[dst * 3 + 2] = tn[i * 3 + 2];
        tdel[dst] = 0;
        dst++;
      }
      nt = dst;
    }
    if (iteration === 0) {
      vq.fill(0);
      for (let i = 0; i < nt; i++) {
        const a = tv[i * 3], b = tv[i * 3 + 1], c = tv[i * 3 + 2];
        const ux = vp[b * 3] - vp[a * 3], uy = vp[b * 3 + 1] - vp[a * 3 + 1], uz = vp[b * 3 + 2] - vp[a * 3 + 2];
        const wx = vp[c * 3] - vp[a * 3], wy = vp[c * 3 + 1] - vp[a * 3 + 1], wz = vp[c * 3 + 2] - vp[a * 3 + 2];
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= l; ny /= l; nz /= l;
        tn[i * 3] = nx; tn[i * 3 + 1] = ny; tn[i * 3 + 2] = nz;
        const dd = -(nx * vp[a * 3] + ny * vp[a * 3 + 1] + nz * vp[a * 3 + 2]);
        const q = [nx * nx, nx * ny, nx * nz, nx * dd, ny * ny, ny * nz, ny * dd, nz * nz, nz * dd, dd * dd];
        for (const v of [a, b, c]) for (let k = 0; k < 10; k++) vq[v * 10 + k] += q[k];
      }
      for (let i = 0; i < nt; i++) {
        for (let j = 0; j < 3; j++) terr[i * 4 + j] = calcError(tv[i * 3 + j], tv[i * 3 + ((j + 1) % 3)]);
        terr[i * 4 + 3] = Math.min(terr[i * 4], terr[i * 4 + 1], terr[i * 4 + 2]);
      }
    }
    vtstart.fill(0);
    vtcount.fill(0);
    for (let i = 0; i < nt * 3; i++) vtcount[tv[i]]++;
    let ts = 0;
    for (let i = 0; i < nv; i++) {
      vtstart[i] = ts;
      ts += vtcount[i];
      vtcount[i] = 0;
    }
    rtid = new Array(nt * 3);
    rtv = new Array(nt * 3);
    for (let i = 0; i < nt; i++) {
      for (let j = 0; j < 3; j++) {
        const v = tv[i * 3 + j];
        const r = vtstart[v] + vtcount[v];
        rtid[r] = i;
        rtv[r] = j;
        vtcount[v]++;
      }
    }
    if (iteration === 0) {
      // Bordes: vértices vecinos que aparecen una sola vez.
      vborder.fill(0);
      const cnt = new Map<number, number>();
      for (let i = 0; i < nv; i++) {
        cnt.clear();
        for (let j = 0; j < vtcount[i]; j++) {
          const t = rtid[vtstart[i] + j];
          for (let k = 0; k < 3; k++) {
            const id = tv[t * 3 + k];
            cnt.set(id, (cnt.get(id) ?? 0) + 1);
          }
        }
        for (const [id, c] of cnt) if (c === 1) vborder[id] = 1;
      }
    }
  };

  const del0: number[] = [];
  const del1: number[] = [];
  const flipped = (px: number, py: number, pz: number, i1: number, v0: number, deleted: number[]): boolean => {
    for (let k = 0; k < vtcount[v0]; k++) {
      const t = rtid[vtstart[v0] + k];
      if (tdel[t]) continue;
      const s = rtv[vtstart[v0] + k];
      const id1 = tv[t * 3 + ((s + 1) % 3)];
      const id2 = tv[t * 3 + ((s + 2) % 3)];
      if (id1 === i1 || id2 === i1) {
        deleted[k] = 1;
        continue;
      }
      let ax = vp[id1 * 3] - px, ay = vp[id1 * 3 + 1] - py, az = vp[id1 * 3 + 2] - pz;
      let bx = vp[id2 * 3] - px, by = vp[id2 * 3 + 1] - py, bz = vp[id2 * 3 + 2] - pz;
      const la = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
      const lb = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
      ax /= la; ay /= la; az /= la; bx /= lb; by /= lb; bz /= lb;
      if (Math.abs(ax * bx + ay * by + az * bz) > 0.999) return true;
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const ln = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= ln; ny /= ln; nz /= ln;
      deleted[k] = 0;
      if (nx * tn[t * 3] + ny * tn[t * 3 + 1] + nz * tn[t * 3 + 2] < 0.2) return true;
    }
    return false;
  };

  let deletedTris = 0;
  const updateTriangles = (i0: number, v: number, deleted: number[]) => {
    for (let k = 0; k < vtcount[v]; k++) {
      const r = vtstart[v] + k;
      const t = rtid[r];
      if (tdel[t]) continue;
      if (deleted[k]) {
        tdel[t] = 1;
        deletedTris++;
        continue;
      }
      tv[t * 3 + rtv[r]] = i0;
      tdirty[t] = 1;
      for (let j = 0; j < 3; j++) terr[t * 4 + j] = calcError(tv[t * 3 + j], tv[t * 3 + ((j + 1) % 3)]);
      terr[t * 4 + 3] = Math.min(terr[t * 4], terr[t * 4 + 1], terr[t * 4 + 2]);
      rtid.push(t);
      rtv.push(rtv[r]);
    }
  };

  const startCount = nt;
  for (let iteration = 0; iteration < 100; iteration++) {
    if (startCount - deletedTris <= target) break;
    if (iteration % 5 === 0) updateMesh(iteration);
    tdirty.fill(0, 0, nt);
    const threshold = 1e-9 * Math.pow(iteration + 3, aggressiveness);
    for (let i = 0; i < nt; i++) {
      if (terr[i * 4 + 3] > threshold || tdel[i] || tdirty[i]) continue;
      for (let j = 0; j < 3; j++) {
        if (terr[i * 4 + j] >= threshold) continue;
        const i0 = tv[i * 3 + j];
        const i1 = tv[i * 3 + ((j + 1) % 3)];
        if (vborder[i0] !== vborder[i1]) continue;
        calcError(i0, i1);
        const px = pr[0], py = pr[1], pz = pr[2];
        del0.length = vtcount[i0];
        del1.length = vtcount[i1];
        if (flipped(px, py, pz, i1, i0, del0)) continue;
        if (flipped(px, py, pz, i0, i1, del1)) continue;
        vp[i0 * 3] = px; vp[i0 * 3 + 1] = py; vp[i0 * 3 + 2] = pz;
        for (let k = 0; k < 10; k++) vq[i0 * 10 + k] += vq[i1 * 10 + k];
        const tstart = rtid.length;
        updateTriangles(i0, i0, del0);
        updateTriangles(i0, i1, del1);
        const tcount = rtid.length - tstart;
        if (tcount <= vtcount[i0]) {
          for (let k = 0; k < tcount; k++) {
            rtid[vtstart[i0] + k] = rtid[tstart + k];
            rtv[vtstart[i0] + k] = rtv[tstart + k];
          }
        } else {
          vtstart[i0] = tstart;
        }
        vtcount[i0] = tcount;
        break;
      }
      if (startCount - deletedTris <= target) break;
    }
  }

  // Compactar: solo vértices usados.
  const remap = new Int32Array(nv).fill(-1);
  const outIdx: number[] = [];
  let outV = 0;
  for (let i = 0; i < nt; i++) {
    if (tdel[i]) continue;
    for (let j = 0; j < 3; j++) {
      const v = tv[i * 3 + j];
      if (remap[v] < 0) remap[v] = outV++;
      outIdx.push(remap[v]);
    }
  }
  const positions = new Float32Array(outV * 3);
  for (let i = 0; i < nv; i++) {
    if (remap[i] < 0) continue;
    positions[remap[i] * 3] = vp[i * 3] / S;
    positions[remap[i] * 3 + 1] = vp[i * 3 + 1] / S;
    positions[remap[i] * 3 + 2] = vp[i * 3 + 2] / S;
  }
  const indices = new Uint32Array(outIdx);
  const normals = faceNormals(positions, indices);
  // liberar
  tv = new Int32Array(0); terr = new Float64Array(0); tdel = new Uint8Array(0); tdirty = new Uint8Array(0); tn = new Float64Array(0);
  return { positions, normals, indices };
}

/** Normales por vértice promediando caras (ponderadas por área). */
export function faceNormals(p: Float32Array, idx: Uint32Array): Float32Array {
  const n = new Float32Array(p.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const wx = p[c] - p[a], wy = p[c + 1] - p[a + 1], wz = p[c + 2] - p[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    for (const v of [a, b, c]) {
      n[v] += nx; n[v + 1] += ny; n[v + 2] += nz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.sqrt(n[i] ** 2 + n[i + 1] ** 2 + n[i + 2] ** 2) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}
