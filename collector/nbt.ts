import { gunzipSync } from "node:zlib";
// A bounded big-endian NBT reader. Reject corruption/unsupported tags rather than
// quietly discarding attributes used to compare expensive configurations.
export function decodeNbt(encoded: unknown): Record<string, unknown> {
  const base64 =
    typeof encoded === "string"
      ? encoded
      : (encoded as { data?: unknown })?.data;
  if (
    typeof base64 !== "string" ||
    !base64.length ||
    base64.length > 1_400_000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
  )
    throw new Error("Invalid base64 item_bytes");
  const compressed = Buffer.from(base64, "base64");
  let data = compressed;
  if (compressed[0] === 31 && compressed[1] === 139) {
    // Collection runs only in Node. Native bounded decompression avoids tens of
    // thousands of JavaScript base64/gzip loops during a full auction snapshot.
    data = gunzipSync(compressed, { maxOutputLength: 2_000_000 });
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 0,
    nodes = 0;
  const need = (n: number) => {
    if (n < 0 || at + n > data.length) throw new Error("Truncated NBT");
  };
  const u8 = () => {
    need(1);
    return data[at++];
  };
  const i32 = () => {
    need(4);
    const n = view.getInt32(at);
    at += 4;
    return n;
  };
  const str = () => {
    need(2);
    const n = view.getUint16(at);
    at += 2;
    need(n);
    const s = new TextDecoder().decode(data.subarray(at, at + n));
    at += n;
    return s;
  };
  function read(type: number, depth: number): unknown {
    if (++nodes > 100_000 || depth > 40) throw new Error("NBT limits exceeded");
    if (type === 1) {
      need(1);
      return view.getInt8(at++);
    }
    if (type === 2) {
      need(2);
      const n = view.getInt16(at);
      at += 2;
      return n;
    }
    if (type === 3) return i32();
    if (type === 4) {
      need(8);
      const n = view.getBigInt64(at);
      at += 8;
      return n <= BigInt(Number.MAX_SAFE_INTEGER) &&
        n >= BigInt(Number.MIN_SAFE_INTEGER)
        ? Number(n)
        : n.toString();
    }
    if (type === 5 || type === 6) {
      const size = type === 5 ? 4 : 8;
      need(size);
      const n = type === 5 ? view.getFloat32(at) : view.getFloat64(at);
      at += size;
      if (!Number.isFinite(n)) throw new Error("Nonfinite NBT");
      return n;
    }
    if (type === 8) return str();
    if ([7, 9, 11, 12].includes(type)) {
      const child = type === 9 ? u8() : type === 7 ? 1 : type === 11 ? 3 : 4;
      const n = i32();
      if (n < 0 || n > 100_000 || (child === 0 && n))
        throw new Error("Invalid NBT array");
      return Array.from({ length: n }, () => read(child, depth + 1));
    }
    if (type === 10) {
      const object: Record<string, unknown> = Object.create(null);
      while (true) {
        const child = u8();
        if (!child) return object;
        const name = str();
        if (Object.hasOwn(object, name)) throw new Error("Duplicate NBT field");
        object[name] = read(child, depth + 1);
      }
    }
    throw new Error(`Unsupported NBT tag ${type}`);
  }
  if (u8() !== 10) throw new Error("Expected NBT compound");
  str();
  const root = read(10, 0) as Record<string, unknown>;
  if (at !== data.length) throw new Error("Trailing NBT bytes");
  return root;
}
