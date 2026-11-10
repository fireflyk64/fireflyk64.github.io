// Minimal ZIP codec, zero dependencies, browser + node (for tests).
//
// Writer: STORED entries only (monster JPEGs are already compressed, and
// stored entries mean any file manager can preview the creatures right
// inside the backup). UTF-8 names, correct CRC-32s, one central directory.
//
// Reader: STORED always; DEFLATE entries too when DecompressionStream is
// available (it is in every modern browser and Node ≥ 21), so backups that
// were unpacked and re-zipped by other tools still restore.
// --- crc32 ------------------------------------------------------------------
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++)
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();
export function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
        c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}
// --- helpers ----------------------------------------------------------------
function dosDateTime(d) {
    return {
        time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
        date: (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
}
class W {
    parts = [];
    length = 0;
    push(b) {
        this.parts.push(b);
        this.length += b.length;
    }
    u16(v) {
        this.push(new Uint8Array([v & 0xff, (v >> 8) & 0xff]));
    }
    u32(v) {
        this.push(new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]));
    }
    concat() {
        const out = new Uint8Array(this.length);
        let o = 0;
        for (const p of this.parts) {
            out.set(p, o);
            o += p.length;
        }
        return out;
    }
}
// --- write ------------------------------------------------------------------
export function zipWrite(entries, now = new Date()) {
    const w = new W();
    const { time, date } = dosDateTime(now);
    const central = [];
    for (const e of entries) {
        const name = new TextEncoder().encode(e.name);
        const crc = crc32(e.data);
        central.push({ name, crc, size: e.data.length, offset: w.length });
        w.push(new Uint8Array([0x50, 0x4b, 0x03, 0x04])); // local header
        w.u16(20); // version needed
        w.u16(0x0800); // flags: UTF-8 names
        w.u16(0); // method: stored
        w.u16(time);
        w.u16(date);
        w.u32(crc);
        w.u32(e.data.length); // compressed
        w.u32(e.data.length); // uncompressed
        w.u16(name.length);
        w.u16(0); // extra len
        w.push(name);
        w.push(e.data);
    }
    const cdStart = w.length;
    for (const c of central) {
        w.push(new Uint8Array([0x50, 0x4b, 0x01, 0x02])); // central header
        w.u16(20 | (3 << 8)); // made by: unix
        w.u16(20);
        w.u16(0x0800);
        w.u16(0);
        w.u16(time);
        w.u16(date);
        w.u32(c.crc);
        w.u32(c.size);
        w.u32(c.size);
        w.u16(c.name.length);
        w.u16(0); // extra
        w.u16(0); // comment
        w.u16(0); // disk
        w.u16(0); // internal attrs
        w.u32(0x81a4 << 16); // external attrs: -rw-r--r--
        w.u32(c.offset);
        w.push(c.name);
    }
    const cdSize = w.length - cdStart;
    w.push(new Uint8Array([0x50, 0x4b, 0x05, 0x06])); // EOCD
    w.u16(0);
    w.u16(0);
    w.u16(central.length);
    w.u16(central.length);
    w.u32(cdSize);
    w.u32(cdStart);
    w.u16(0);
    return w.concat();
}
// --- read -------------------------------------------------------------------
function u16(b, o) {
    return b[o] | (b[o + 1] << 8);
}
function u32(b, o) {
    return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}
async function inflateRaw(data) {
    const DS = globalThis.DecompressionStream;
    if (!DS)
        throw new Error("this backup uses compression this device cannot read");
    const copy = new Uint8Array(data);
    const stream = new Blob([copy.buffer]).stream().pipeThrough(new DS("deflate-raw"));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
}
export async function zipRead(bytes) {
    // find EOCD: scan back for PK\x05\x06 (max comment 64k)
    let eocd = -1;
    const stop = Math.max(0, bytes.length - 65557);
    for (let i = bytes.length - 22; i >= stop; i--) {
        if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0)
        throw new Error("not a zip file");
    const count = u16(bytes, eocd + 10);
    let o = u32(bytes, eocd + 16); // central directory offset
    const entries = [];
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
        if (u32(bytes, o) !== 0x02014b50)
            throw new Error("bad central directory");
        const method = u16(bytes, o + 10);
        const crc = u32(bytes, o + 16);
        const csize = u32(bytes, o + 20);
        const usize = u32(bytes, o + 24);
        const nameLen = u16(bytes, o + 28);
        const extraLen = u16(bytes, o + 30);
        const commentLen = u16(bytes, o + 32);
        const localOff = u32(bytes, o + 42);
        const name = dec.decode(bytes.subarray(o + 46, o + 46 + nameLen));
        o = o + 46 + nameLen + extraLen + commentLen;
        if (u32(bytes, localOff) !== 0x04034b50)
            throw new Error("bad local header");
        const lNameLen = u16(bytes, localOff + 26);
        const lExtraLen = u16(bytes, localOff + 28);
        const dataStart = localOff + 30 + lNameLen + lExtraLen;
        const raw = bytes.subarray(dataStart, dataStart + csize);
        if (name.endsWith("/"))
            continue; // directory entry
        let data;
        if (method === 0) {
            data = new Uint8Array(raw);
        }
        else if (method === 8) {
            data = await inflateRaw(raw);
        }
        else {
            throw new Error(`unsupported zip compression method ${method}`);
        }
        if (data.length !== usize || crc32(data) !== crc) {
            throw new Error(`corrupt entry: ${name}`);
        }
        entries.push({ name, data });
    }
    return entries;
}
