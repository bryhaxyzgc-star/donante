// Formato binario simple para las mallas precalculadas: un JSON con la descripción
// de cada pieza y un .bin con los arreglos alineados a 4 bytes.

export type ArrayKind = 'f32' | 'u16' | 'u32';

export interface BufferRef {
  offset: number;
  count: number;
  type: ArrayKind;
}

export interface AssetEntry {
  kind: 'bone' | 'skin' | 'muscle' | 'organ';
  name: string;
  slot?: string;
  bone?: string;
  material?: string;
  center?: [number, number, number];
  attributes: Record<string, BufferRef & { itemSize: number }>;
  index: BufferRef;
}

export interface AssetFile {
  version: number;
  generator: string;
  entries: AssetEntry[];
}

export type TypedArray = Float32Array | Uint16Array | Uint32Array;

export interface DecodedEntry extends Omit<AssetEntry, 'attributes' | 'index'> {
  attributes: Record<string, { array: TypedArray; itemSize: number }>;
  index: Uint16Array | Uint32Array;
}

export const ASSET_VERSION = 3;

const kindOf = (a: TypedArray): ArrayKind => (a instanceof Float32Array ? 'f32' : a instanceof Uint16Array ? 'u16' : 'u32');

export class AssetWriter {
  private chunks: Uint8Array[] = [];
  private size = 0;
  readonly entries: AssetEntry[] = [];

  private put(a: TypedArray): BufferRef {
    const pad = (4 - (this.size % 4)) % 4;
    if (pad) {
      this.chunks.push(new Uint8Array(pad));
      this.size += pad;
    }
    const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const ref = { offset: this.size, count: a.length, type: kindOf(a) };
    this.chunks.push(bytes.slice());
    this.size += bytes.length;
    return ref;
  }

  add(meta: Omit<AssetEntry, 'attributes' | 'index'>, attrs: Record<string, [TypedArray, number]>, index: Uint32Array): void {
    const vc = attrs.position[0].length / 3;
    const idx = vc < 65536 ? Uint16Array.from(index) : index;
    const attributes: AssetEntry['attributes'] = {};
    for (const [name, [arr, itemSize]] of Object.entries(attrs)) attributes[name] = { ...this.put(arr), itemSize };
    this.entries.push({ ...meta, attributes, index: this.put(idx) });
  }

  finish(generator: string): { json: AssetFile; bin: Uint8Array } {
    const bin = new Uint8Array(this.size);
    let o = 0;
    for (const c of this.chunks) {
      bin.set(c, o);
      o += c.length;
    }
    return { json: { version: ASSET_VERSION, generator, entries: this.entries }, bin };
  }
}

function view(buf: ArrayBuffer, r: BufferRef): TypedArray {
  if (r.type === 'f32') return new Float32Array(buf, r.offset, r.count);
  if (r.type === 'u16') return new Uint16Array(buf, r.offset, r.count);
  return new Uint32Array(buf, r.offset, r.count);
}

export function decodeAssets(json: AssetFile, buf: ArrayBuffer): DecodedEntry[] {
  return json.entries.map((e) => {
    const attributes: DecodedEntry['attributes'] = {};
    for (const [name, r] of Object.entries(e.attributes)) attributes[name] = { array: view(buf, r), itemSize: r.itemSize };
    return { ...e, attributes, index: view(buf, e.index) as Uint16Array | Uint32Array };
  });
}
