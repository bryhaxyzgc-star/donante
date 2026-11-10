// Visor de assets del pipeline de Blender (solo debug, panel G → Debug → assetViewer):
// el corazón con sus vasos en cadena y las costillas fracturadas del cerdo en vista explosionada.
// Sirve para verificar la Fase 2 sin esperar a la cinemática.
import {
  DoubleSide, Group, Mesh, MeshPhysicalMaterial, SkeletonHelper, Vector3, type Object3D, type SkinnedMesh,
} from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { config } from '../config.ts';
import type { BodyAssets } from '../anatomy/assets.ts';

export class AssetViewer {
  readonly group = new Group();
  /** Helpers que van en la raíz de la escena (SkeletonHelper ya dibuja en espacio de mundo). */
  readonly helpers: Object3D[] = [];
  private heart: Object3D | null = null;
  private ribs: Group | null = null;
  private mode: string = 'ninguno';
  private t = 0;
  private ribCenter = new Vector3();

  constructor(assets: BodyAssets) {
    this.group.visible = false;
    // Delante de la cámara, a 1,1 m (la cámara está en el origen mirando a -Z).
    this.group.position.set(0, 0, -1.1);
    if (assets.heartRig) {
      const h = cloneSkinned(assets.heartRig);
      const flesh = new MeshPhysicalMaterial({ color: '#6a0a12', roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1, sheen: 0.4, sheenColor: '#ff8a9a' });
      const vessel = new MeshPhysicalMaterial({ color: '#7a1018', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12, side: DoubleSide });
      let center = new Vector3();
      h.traverse((o) => {
        const m = o as SkinnedMesh;
        if (!m.isMesh) return;
        m.material = m.userData.donante_role === 'vessel' || m.parent?.userData?.donante_role === 'vessel' ? vessel : flesh;
        m.frustumCulled = false;
        const c = m.userData.donante_center as number[] | undefined;
        if (c) center = new Vector3(...c);
      });
      h.position.copy(center).multiplyScalar(-1);
      const pivot = new Group();
      pivot.add(h);
      const helper = new SkeletonHelper(h);
      helper.visible = false;
      this.helpers.push(helper);
      pivot.scale.setScalar(2.2);
      this.heart = pivot;
      this.group.add(pivot);
    }
    if (assets.ribFragments.length) {
      const g = new Group();
      const bone = new MeshPhysicalMaterial({ color: '#dfe7ee', roughness: 0.4, clearcoat: 0.3 });
      const marrow = new MeshPhysicalMaterial({ color: '#7a0d14', roughness: 0.7 });
      const c = new Vector3();
      let n = 0;
      for (const f of assets.ribFragments) {
        f.geometry.computeBoundingSphere();
        c.add(f.geometry.boundingSphere!.center);
        n++;
      }
      c.divideScalar(Math.max(1, n));
      this.ribCenter.copy(c);
      for (const f of assets.ribFragments) {
        const m = new Mesh(f.geometry, f.material === 'marrow' ? marrow : bone);
        const fc = f.geometry.boundingSphere!.center;
        m.userData.dir = fc.clone().sub(c);
        m.position.copy(c).multiplyScalar(-1);
        g.add(m);
      }
      g.scale.setScalar(1.6);
      this.ribs = g;
      this.group.add(g);
    }
  }

  update(dt: number): void {
    const mode = config.debug.assetViewer;
    if (mode !== this.mode) {
      this.mode = mode;
      this.t = 0;
    }
    this.group.visible = mode !== 'ninguno';
    if (this.heart) this.heart.visible = mode === 'corazon';
    for (const h of this.helpers) h.visible = mode === 'corazon';
    if (this.ribs) this.ribs.visible = mode === 'costillas';
    if (!this.group.visible) return;
    this.t += dt;
    this.group.rotation.y = Math.sin(this.t * 0.4) * 0.9;
    if (this.ribs && mode === 'costillas') {
      // Explosión lenta que va y vuelve: deja ver cada pieza y su cara de médula.
      const e = 0.5 - 0.5 * Math.cos(this.t * 0.8);
      for (const m of this.ribs.children) {
        const d = m.userData.dir as Vector3;
        m.position.copy(this.ribCenter).negate().addScaledVector(d, e * 0.6);
      }
    }
  }
}
