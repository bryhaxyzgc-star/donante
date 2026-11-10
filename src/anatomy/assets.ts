// Carga las mallas del cuerpo según public/models/manifest.json.
// - Fase 2: GLB del pipeline de Blender (human.glb, pig.glb, heart.glb) con Draco.
// - Respaldo: placeholders procedurales precalculados (Fase 1) si un GLB falta o falla.
// Contrato de los GLB (extras de glTF → userData): ver blender/README.md.
import { BufferAttribute, BufferGeometry, Mesh, Object3D, SkinnedMesh, Vector3, type Bone } from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { fetchWithProgress } from '../input/pose.ts';
import { decodeAssets, type AssetFile, type DecodedEntry } from './assetFormat.ts';
import { BONE_NAMES, PROCEDURAL_META, type BoneName, type RigMeta, type V3 } from './armature.ts';
import { asset } from '../base.ts';

export interface BoneGeo {
  slot: string;
  bone: BoneName;
  material: 'bone' | 'teeth' | 'cartilage' | 'soft';
  geometry: BufferGeometry;
}

export interface OrganGeo {
  name: 'heart' | 'lungs' | 'liver';
  bone: BoneName;
  center: Vector3;
  geometry: BufferGeometry;
}

/** Fragmento de costilla pre-fracturado (Fase 6: física). */
export interface FragmentGeo {
  rib: number;
  side: 'L' | 'R';
  piece: number;
  bone: BoneName;
  /** 'bone' = superficie de la costilla; 'marrow' = cara de corte (médula). */
  material: 'bone' | 'marrow';
  geometry: BufferGeometry;
}

export interface BodyAssets {
  source: string;
  /** Posiciones de reposo de las articulaciones (modelo). Sin definir → armadura procedural. */
  rest?: Record<BoneName, V3>;
  meta: RigMeta;
  bones: BoneGeo[];
  /** Huesos del cerdo en la misma armadura (vacío con placeholders). */
  pigBones: BoneGeo[];
  ribFragments: FragmentGeo[];
  skin: BufferGeometry;
  muscle: BufferGeometry;
  organs: OrganGeo[];
  /** Corazón con vasos en cadena (heart.glb), para la cinemática. */
  heartRig: Object3D | null;
}

type Progress = (f: number, label: string) => void;

// ── placeholders (Fase 1) ──────────────────────────────────────

function toGeometry(e: DecodedEntry): BufferGeometry {
  const g = new BufferGeometry();
  for (const [name, { array, itemSize }] of Object.entries(e.attributes)) {
    g.setAttribute(name, new BufferAttribute(array, itemSize));
  }
  g.setIndex(new BufferAttribute(e.index, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

function emptyAssets(source: string): BodyAssets {
  return {
    source, meta: PROCEDURAL_META, bones: [], pigBones: [], ribFragments: [],
    skin: new BufferGeometry(), muscle: new BufferGeometry(), organs: [], heartRig: null,
  };
}

function buildPlaceholder(entries: DecodedEntry[], source: string): BodyAssets {
  const out = emptyAssets(source);
  for (const e of entries) {
    const g = toGeometry(e);
    if (e.kind === 'bone') out.bones.push({ slot: e.slot!, bone: e.bone as BoneName, material: e.material as BoneGeo['material'], geometry: g });
    else if (e.kind === 'skin') out.skin = g;
    else if (e.kind === 'muscle') out.muscle = g;
    else out.organs.push({ name: e.name as OrganGeo['name'], bone: e.bone as BoneName, center: new Vector3(...(e.center ?? [0, 0, 0])), geometry: g });
  }
  return out;
}

async function loadPlaceholder(path: string, onProgress: (f: number) => void): Promise<BodyAssets> {
  const res = await fetch(asset(`${path}.json`));
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.includes('json')) throw new Error('placeholder no encontrado');
  const json = (await res.json()) as AssetFile;
  const bin = await fetchWithProgress(asset(`${path}.bin`), onProgress);
  return buildPlaceholder(decodeAssets(json, bin), 'placeholder');
}

/** Genera los placeholders en un worker si no fueron precalculados (tarda ~30-60 s). */
function generateInWorker(onProgress: Progress): Promise<BodyAssets> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./generate.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent) => {
      const m = ev.data as { type: 'progress'; f: number; label: string } | { type: 'done'; json: AssetFile; bin: ArrayBuffer };
      if (m.type === 'progress') onProgress(m.f, m.label);
      else {
        w.terminate();
        resolve(buildPlaceholder(decodeAssets(m.json, m.bin), 'placeholder (generado en el navegador)'));
      }
    };
    w.onerror = (e) => reject(new Error(e.message));
  });
}

// ── GLB (Fase 2) ───────────────────────────────────────────────

let loader: GLTFLoader | null = null;
function gltfLoader(): GLTFLoader {
  if (!loader) {
    const draco = new DRACOLoader().setDecoderPath(asset('decoders/draco/'));
    draco.preload();
    loader = new GLTFLoader().setDRACOLoader(draco);
    // KTX2Loader se agrega cuando los GLB traigan texturas (hoy los materiales son de la app).
  }
  return loader;
}

async function loadGLB(url: string, onProgress: (f: number) => void): Promise<Object3D> {
  const gltf = await gltfLoader().loadAsync(url, (e) => {
    if (e.total) onProgress(e.loaded / e.total);
  });
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
}

/** Extras de Blender (custom properties) de un objeto o de su nodo padre. */
function extras(o: Object3D): Record<string, unknown> {
  const own = o.userData ?? {};
  if (own.donante_role) return own;
  return o.parent?.userData?.donante_role ? o.parent.userData : own;
}

const boneIndex = new Map<string, number>(BONE_NAMES.map((n, i) => [n, i]));

/** Geometría en espacio de modelo; en las skinneadas, índices de bones remapeados a BONE_NAMES. */
function bakeGeometry(mesh: Mesh): BufferGeometry {
  const g = mesh.geometry.clone();
  if ((mesh as SkinnedMesh).isSkinnedMesh) {
    const sm = mesh as SkinnedMesh;
    g.applyMatrix4(sm.bindMatrix);
    const idx = g.getAttribute('skinIndex');
    const out = new Uint16Array(idx.count * 4);
    const bones = sm.skeleton.bones;
    for (let i = 0; i < idx.count; i++) {
      for (let c = 0; c < 4; c++) {
        const b = bones[idx.getComponent(i, c)];
        out[i * 4 + c] = boneIndex.get(b?.name ?? '') ?? 0;
      }
    }
    g.setAttribute('skinIndex', new BufferAttribute(out, 4));
    // Fibra muscular codificada como color de vértice (0..1 → -1..1).
    const col = g.getAttribute('color');
    if (col) {
      const f = new Float32Array(col.count * 3);
      for (let i = 0; i < col.count; i++) {
        f[i * 3] = col.getX(i) * 2 - 1;
        f[i * 3 + 1] = col.getY(i) * 2 - 1;
        f[i * 3 + 2] = col.getZ(i) * 2 - 1;
      }
      g.setAttribute('fiber', new BufferAttribute(f, 3));
      g.deleteAttribute('color');
    }
  } else {
    g.applyMatrix4(mesh.matrixWorld);
  }
  for (const name of Object.keys(g.attributes)) {
    if (!['position', 'normal', 'skinIndex', 'skinWeight', 'fiber'].includes(name)) g.deleteAttribute(name);
  }
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

function restFrom(scene: Object3D): Record<BoneName, V3> | undefined {
  const rest = {} as Record<BoneName, V3>;
  const v = new Vector3();
  let found = 0;
  scene.traverse((o) => {
    if ((o as Bone).isBone && boneIndex.has(o.name)) {
      o.getWorldPosition(v);
      rest[o.name as BoneName] = [v.x, v.y, v.z];
      found++;
    }
  });
  return found === BONE_NAMES.length ? rest : undefined;
}

function metaFrom(scene: Object3D): RigMeta {
  let meta: RigMeta = PROCEDURAL_META;
  scene.traverse((o) => {
    const raw = o.userData?.donante_meta;
    if (typeof raw === 'string') {
      try {
        meta = { ...PROCEDURAL_META, ...JSON.parse(raw) };
      } catch {
        /* metadatos ilegibles: pose A */
      }
    }
  });
  return meta;
}

function collect(scene: Object3D, out: BodyAssets, species: 'human' | 'pig'): void {
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const x = extras(mesh);
    const role = x.donante_role as string | undefined;
    if (!role) return;
    if (role === 'skin' || role === 'muscle') {
      if (!(mesh as SkinnedMesh).isSkinnedMesh) return;
      out[role] = bakeGeometry(mesh);
    } else if (role === 'bone') {
      const g: BoneGeo = { slot: String(x.donante_slot), bone: x.donante_bone as BoneName, material: (x.donante_material as BoneGeo['material']) ?? 'bone', geometry: bakeGeometry(mesh) };
      (species === 'pig' ? out.pigBones : out.bones).push(g);
    } else if (role === 'organ') {
      const c = (x.donante_center as V3) ?? [0, 0, 0];
      out.organs.push({ name: x.donante_organ as OrganGeo['name'], bone: x.donante_bone as BoneName, center: new Vector3(...c), geometry: bakeGeometry(mesh) });
    } else if (role === 'fragment') {
      const matName = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)?.name ?? '';
      out.ribFragments.push({
        rib: Number(x.donante_rib), side: x.donante_side as 'L' | 'R', piece: Number(x.donante_piece),
        bone: (x.donante_bone as BoneName) ?? 'Spine2', material: matName.startsWith('marrow') ? 'marrow' : 'bone',
        geometry: bakeGeometry(mesh),
      });
    }
  });
}

interface ManifestEntry {
  type: 'glb' | 'placeholder';
  path: string;
}
interface Manifest {
  human?: ManifestEntry | null;
  pig?: ManifestEntry | null;
  heart?: ManifestEntry | null;
  placeholder?: ManifestEntry | null;
}

async function loadFromGLB(m: Manifest, onProgress: Progress): Promise<BodyAssets> {
  const human = await loadGLB(asset(m.human!.path), (f) => onProgress(f * 0.6, 'anatomía · humano'));
  const out = emptyAssets(`GLB ${m.human!.path}`);
  out.rest = restFrom(human);
  if (!out.rest) throw new Error('human.glb sin la armadura completa (nombres Mixamo)');
  out.meta = metaFrom(human);
  collect(human, out, 'human');
  if (!out.skin.getAttribute('position') || !out.bones.length) throw new Error('human.glb incompleto (piel o huesos)');
  if (m.pig?.type === 'glb') {
    try {
      const pig = await loadGLB(asset(m.pig.path), (f) => onProgress(0.6 + f * 0.25, 'anatomía · cerdo'));
      collect(pig, out, 'pig');
    } catch (err) {
      console.warn('[assets] pig.glb no cargó; la transformación usará placeholders', err);
    }
  }
  if (m.heart?.type === 'glb') {
    try {
      out.heartRig = await loadGLB(asset(m.heart.path), (f) => onProgress(0.85 + f * 0.15, 'anatomía · corazón'));
    } catch (err) {
      console.warn('[assets] heart.glb no cargó', err);
    }
  }
  onProgress(1, 'anatomía');
  return out;
}

export async function loadBodyAssets(onProgress: Progress): Promise<BodyAssets> {
  let manifest: Manifest = {};
  try {
    const r = await fetch(asset('models/manifest.json'));
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) manifest = await r.json();
  } catch {
    /* sin manifiesto: placeholders */
  }
  if (manifest.human?.type === 'glb') {
    try {
      return await loadFromGLB(manifest, onProgress);
    } catch (err) {
      console.error('[assets] GLB del humano falló; se usan placeholders:', err);
    }
  }
  const ph = manifest.placeholder ?? (manifest.human?.type === 'placeholder' ? manifest.human : null) ?? { type: 'placeholder', path: 'models/placeholder/human' };
  try {
    return await loadPlaceholder(ph.path, (f) => onProgress(f, 'anatomía'));
  } catch (err) {
    console.warn('[assets] placeholders no precalculados (npm run placeholders). Generando en el navegador…', err);
    return generateInWorker(onProgress);
  }
}
