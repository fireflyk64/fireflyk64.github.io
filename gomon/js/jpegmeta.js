// Embed / extract GoMon monster metadata inside JPEG files using APP15
// (0xFFEF) application segments, so every monster sprite JPEG is fully
// self-contained: save it to your photo reel, send it to a friend, re-import
// it, and the creature comes back with stats, typing, lineage and all.
//
// Segment payload layout (after the 2-byte length):
//   "GoMon1\0"  (7 bytes signature)
//   u8 chunkIndex, u8 chunkCount
//   UTF-8 JSON slice
//
// JSON larger than one segment (~64KB cap) is split across consecutive
// APP15 chunks. Pure module: only Uint8Array/TextEncoder, runs in node too.
const SIG = new Uint8Array([0x47, 0x6f, 0x4d, 0x6f, 0x6e, 0x31, 0x00]); // "GoMon1\0"
const APP15 = 0xef;
const MAX_JSON_PER_SEGMENT = 60000;
class ByteWriter {
    parts = [];
    push(b) {
        this.parts.push(b);
    }
    concat() {
        const len = this.parts.reduce((n, p) => n + p.length, 0);
        const out = new Uint8Array(len);
        let o = 0;
        for (const p of this.parts) {
            out.set(p, o);
            o += p.length;
        }
        return out;
    }
}
function isJpeg(bytes) {
    return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
}
/** Walk marker segments from SOI until SOS/EOI (entropy data is not parsed). */
function* segments(bytes) {
    let o = 2; // skip SOI
    while (o + 3 < bytes.length) {
        if (bytes[o] !== 0xff)
            return; // corrupt or entropy data — stop
        let marker = bytes[o + 1];
        // fill bytes: FF FF ... marker
        let mo = o + 1;
        while (marker === 0xff && mo + 1 < bytes.length) {
            mo++;
            marker = bytes[mo];
        }
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
            yield { marker, start: o, end: mo + 1, payloadStart: mo + 1, payloadEnd: mo + 1 };
            if (marker === 0xd9)
                return;
            o = mo + 1;
            continue;
        }
        if (mo + 3 >= bytes.length)
            return;
        const len = (bytes[mo + 1] << 8) | bytes[mo + 2];
        if (len < 2 || mo + 1 + len > bytes.length)
            return;
        const seg = {
            marker,
            start: o,
            end: mo + 1 + len,
            payloadStart: mo + 3,
            payloadEnd: mo + 1 + len,
        };
        yield seg;
        if (marker === 0xda)
            return; // SOS — entropy-coded data follows
        o = seg.end;
    }
}
function isGomonSegment(bytes, seg) {
    if (seg.marker !== APP15)
        return false;
    if (seg.payloadEnd - seg.payloadStart < SIG.length + 2)
        return false;
    for (let i = 0; i < SIG.length; i++) {
        if (bytes[seg.payloadStart + i] !== SIG[i])
            return false;
    }
    return true;
}
/** Remove any existing GoMon APP15 segments. */
export function stripMeta(jpeg) {
    if (!isJpeg(jpeg))
        return jpeg;
    const w = new ByteWriter();
    let cursor = 0;
    for (const seg of segments(jpeg)) {
        if (isGomonSegment(jpeg, seg)) {
            w.push(jpeg.subarray(cursor, seg.start));
            cursor = seg.end;
        }
        if (seg.marker === 0xda)
            break;
    }
    w.push(jpeg.subarray(cursor));
    return w.concat();
}
function buildSegments(json) {
    const data = new TextEncoder().encode(json);
    const chunkCount = Math.max(1, Math.ceil(data.length / MAX_JSON_PER_SEGMENT));
    if (chunkCount > 255)
        throw new Error("gomon metadata too large for JPEG embedding");
    const w = new ByteWriter();
    for (let i = 0; i < chunkCount; i++) {
        const slice = data.subarray(i * MAX_JSON_PER_SEGMENT, (i + 1) * MAX_JSON_PER_SEGMENT);
        const payloadLen = SIG.length + 2 + slice.length;
        const segLen = payloadLen + 2; // includes the two length bytes
        const head = new Uint8Array(4 + SIG.length + 2);
        head[0] = 0xff;
        head[1] = APP15;
        head[2] = (segLen >> 8) & 0xff;
        head[3] = segLen & 0xff;
        head.set(SIG, 4);
        head[4 + SIG.length] = i;
        head[5 + SIG.length] = chunkCount;
        w.push(head);
        w.push(slice);
    }
    return w.concat();
}
/**
 * Embed `meta` (any JSON-serializable object) into the JPEG, replacing any
 * previous GoMon metadata. Segments are inserted after SOI and any leading
 * APP0/APP1 (JFIF/EXIF) so standard readers stay happy.
 */
export function embedMeta(jpeg, meta) {
    if (!isJpeg(jpeg))
        throw new Error("not a JPEG file");
    const clean = stripMeta(jpeg);
    let insertAt = 2;
    for (const seg of segments(clean)) {
        if (seg.marker === 0xe0 || seg.marker === 0xe1) {
            insertAt = seg.end;
            continue;
        }
        break;
    }
    const block = buildSegments(JSON.stringify(meta));
    const out = new Uint8Array(clean.length + block.length);
    out.set(clean.subarray(0, insertAt), 0);
    out.set(block, insertAt);
    out.set(clean.subarray(insertAt), insertAt + block.length);
    return out;
}
/** Extract embedded GoMon metadata; null if none present or unparsable. */
export function extractMeta(jpeg) {
    if (!isJpeg(jpeg))
        return null;
    const chunks = [];
    for (const seg of segments(jpeg)) {
        if (isGomonSegment(jpeg, seg)) {
            const base = seg.payloadStart + SIG.length;
            chunks.push({
                index: jpeg[base],
                count: jpeg[base + 1],
                data: jpeg.subarray(base + 2, seg.payloadEnd),
            });
        }
        if (seg.marker === 0xda)
            break;
    }
    if (!chunks.length)
        return null;
    const count = chunks[0].count;
    if (chunks.length !== count)
        return null;
    chunks.sort((a, b) => a.index - b.index);
    const w = new ByteWriter();
    for (let i = 0; i < count; i++) {
        if (chunks[i].index !== i)
            return null;
        w.push(chunks[i].data);
    }
    try {
        return JSON.parse(new TextDecoder().decode(w.concat()));
    }
    catch {
        return null;
    }
}
