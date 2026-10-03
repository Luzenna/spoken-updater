// @ts-check
// Minimal reader for Battle.net's product.db (a protobuf message). We only need:
//   ProductDb.1        repeated Product
//   Product.1          product code, e.g. "wow_classic_beta"
//   Product.3.1        install root, e.g. "C:/Program Files (x86)/World of Warcraft"
//   Product.3.13       client subfolder, e.g. "_classic_beta_"
//   Product.4.1.7      installed version, e.g. "1.60.1.70205"
// Field numbers match WowUp's product-db.ts and were checked against a real file.

/** @typedef {{ code: string, location: string | null, folder: string | null, version: string | null }} Product */

/**
 * Decode one level of a protobuf message into field number -> list of raw values.
 * Length-delimited values stay as Buffers; varints become numbers.
 * @param {Buffer} buf @returns {Map<number, (Buffer | number)[]>}
 */
export function decodeFields(buf) {
  /** @type {Map<number, (Buffer | number)[]>} */
  const out = new Map();
  let i = 0;
  const varint = () => {
    let result = 0, shift = 0, b;
    do {
      if (i >= buf.length) throw new Error('truncated varint');
      b = buf[i++];
      result += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80);
    return result;
  };
  while (i < buf.length) {
    const key = varint();
    const field = Math.floor(key / 8), wire = key & 7;
    /** @type {Buffer | number} */
    let val;
    if (wire === 0) val = varint();
    else if (wire === 2) {
      const len = varint();
      if (i + len > buf.length) throw new Error('truncated field');
      val = buf.subarray(i, i + len);
      i += len;
    } else if (wire === 1) { val = 0; i += 8; }
    else if (wire === 5) { val = 0; i += 4; }
    else throw new Error(`unsupported wire type ${wire}`);
    if (!out.has(field)) out.set(field, []);
    /** @type {(Buffer | number)[]} */ (out.get(field)).push(val);
  }
  return out;
}

/** @param {Map<number, (Buffer|number)[]>} m @param {number} f */
const sub = (m, f) => {
  const v = m.get(f)?.[0];
  return Buffer.isBuffer(v) ? decodeFields(v) : null;
};
/** @param {Map<number, (Buffer|number)[]> | null} m @param {number} f */
const str = (m, f) => {
  const v = m?.get(f)?.[0];
  return Buffer.isBuffer(v) ? v.toString('utf8') : null;
};

/** @param {Buffer} buf @returns {Product[]} */
export function parseProductDb(buf) {
  let top;
  try {
    top = decodeFields(buf);
  } catch {
    return []; // corrupt or a format we don't know
  }
  /** @type {Product[]} */
  const products = [];
  for (const raw of top.get(1) ?? []) {
    if (!Buffer.isBuffer(raw)) continue;
    try {
      const p = decodeFields(raw);
      const code = str(p, 1);
      if (!code) continue;
      const client = sub(p, 3);
      const state = sub(p, 4);
      const inner = state ? sub(state, 1) : null;
      products.push({ code, location: str(client, 1), folder: str(client, 13), version: str(inner, 7) });
    } catch {
      // A product we can't decode is just skipped.
    }
  }
  return products;
}

// Test helper and documentation of the layout: encode products the way Battle.net does.
/** @param {Product[]} products @returns {Buffer} */
export function encodeProductDb(products) {
  /** @param {number} n */
  const varint = (n) => {
    const b = [];
    while (n > 0x7f) { b.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
    b.push(n);
    return Buffer.from(b);
  };
  /** @param {number} f @param {Buffer | string} v */
  const ld = (f, v) => {
    const data = Buffer.isBuffer(v) ? v : Buffer.from(v, 'utf8');
    return Buffer.concat([varint(f * 8 + 2), varint(data.length), data]);
  };
  const parts = products.map((p) => {
    const client = Buffer.concat([
      p.location ? ld(1, p.location) : Buffer.alloc(0),
      ld(2, 'us'),
      p.folder ? ld(13, p.folder) : Buffer.alloc(0),
    ]);
    const state = ld(1, p.version ? ld(7, p.version) : Buffer.alloc(0));
    return ld(1, Buffer.concat([ld(1, p.code), ld(2, p.code), ld(3, client), ld(4, state), ld(6, 'wow')]));
  });
  return Buffer.concat([...parts, ...products.map((p) => ld(7, p.code))]);
}
