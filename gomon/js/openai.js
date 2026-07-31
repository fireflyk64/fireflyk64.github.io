// OpenAI generation pipeline. All calls run directly from the device with
// the user-supplied token (see auth.ts) — the game server never sees it.
//
//  - describeMonsterFromPhoto: vision + structured JSON → species spec
//    (name, typing, stats, description, 0-2 evolution specs)
//  - pixelSpriteFromPhoto: images/edits (photo in, pixel-art monster out, JPEG)
//  - evolutionSprite: images/edits (current sprite in, evolved form out)
//  - breedSprite / breedSpec: two parents in, offspring sprite + stats out
import { getToken } from "./auth.js";
import { clampStats, sanitizeMove, sanitizeTypes, TYPE_NAMES } from "./model.js";
const API = "https://api.openai.com/v1";
const CHAT_MODEL = "gpt-4o-mini";
const IMAGE_MODEL = "gpt-image-1";
export class OpenAIError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = "OpenAIError";
    }
}
function authHeader() {
    const token = getToken();
    if (!token)
        throw new OpenAIError(401, "No OpenAI token — connect one in Settings.");
    return { authorization: `Bearer ${token}` };
}
async function fail(res) {
    let msg = `${res.status} ${res.statusText}`;
    try {
        const body = (await res.json());
        if (body.error?.message)
            msg = body.error.message;
    }
    catch { /* keep default */ }
    throw new OpenAIError(res.status, msg);
}
// --- helpers ----------------------------------------------------------------
export async function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error ?? new Error("read failed"));
        r.readAsDataURL(blob);
    });
}
export function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        out[i] = bin.charCodeAt(i);
    return out;
}
/** Downscale a photo so uploads are fast and vision tokens stay cheap. */
export async function downscaleJpeg(blob, maxDim = 1024, quality = 0.85) {
    try {
        const bmp = await createImageBitmap(blob);
        const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
        if (scale >= 1 && blob.type === "image/jpeg")
            return blob;
        const w = Math.max(1, Math.round(bmp.width * scale));
        const h = Math.max(1, Math.round(bmp.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx)
            return blob;
        ctx.drawImage(bmp, 0, 0, w, h);
        return await new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? blob), "image/jpeg", quality));
    }
    catch {
        return blob;
    }
}
const SPEC_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["species", "description", "types", "baseStats", "photoNote", "imagePrompt", "evolutions"],
    properties: {
        species: { type: "string", description: "Invented species name, 3-14 characters, punchy." },
        description: { type: "string", description: "One or two flavorful dex sentences." },
        types: { type: "array", items: { type: "string", enum: [...TYPE_NAMES] }, description: "1 or 2 elemental types." },
        baseStats: {
            type: "object",
            additionalProperties: false,
            required: ["hp", "atk", "def", "spa", "spd", "spe"],
            properties: {
                hp: { type: "integer" }, atk: { type: "integer" }, def: { type: "integer" },
                spa: { type: "integer" }, spd: { type: "integer" }, spe: { type: "integer" },
            },
            description: "Each 20-150, total roughly 300-450.",
        },
        photoNote: { type: "string", description: "What in the photo inspired the monster, one short phrase." },
        imagePrompt: { type: "string", description: "A vivid visual description of the monster for a pixel artist." },
        evolutions: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "description", "imagePrompt", "statMult", "atLevel"],
                properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    imagePrompt: { type: "string", description: "How the creature changes visually when it evolves." },
                    statMult: { type: "number", description: "Base stat multiplier vs previous stage, 1.15-1.5." },
                    atLevel: { type: "integer", description: "Evolution level: 16 for first, 32 for second." },
                },
            },
        },
    },
};
export async function describeMonsterFromPhoto(photo, evolutionCount) {
    const dataUrl = await blobToDataUrl(await downscaleJpeg(photo, 768));
    const res = await fetch(`${API}/chat/completions`, {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: JSON.stringify({
            model: CHAT_MODEL,
            max_tokens: 1200,
            response_format: {
                type: "json_schema",
                json_schema: { name: "monster_spec", strict: true, schema: SPEC_SCHEMA },
            },
            messages: [
                {
                    role: "system",
                    content: "You are the field laboratory of GoMon, a walk-and-catch pocket monster game. " +
                        "Given a photo a player took of their surroundings, invent ONE original pocket " +
                        "monster inspired by the most distinctive subject in the photo (a plant, animal, " +
                        "sign, machine, texture, building — anything). Derive typing from the subject's " +
                        "nature and colors (e.g. red berries might yield poison/grass). Stats: each " +
                        "20-150, total 300-450, shaped by the subject (spiky → atk, sturdy → def, " +
                        `airborne → spe). Produce exactly ${evolutionCount} evolution stage(s) beyond ` +
                        "the base form (first at level 16, second at 32), each strictly more powerful " +
                        "and visually escalated. Never depict humans; invent creatures, not copies of " +
                        "existing franchise monsters.",
                },
                {
                    role: "user",
                    content: [
                        { type: "text", text: `Invent my monster from this photo (${evolutionCount} evolutions).` },
                        { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
                    ],
                },
            ],
        }),
    });
    if (!res.ok)
        await fail(res);
    const body = (await res.json());
    const content = body.choices?.[0]?.message?.content;
    if (!content)
        throw new OpenAIError(500, "Empty model response");
    const raw = JSON.parse(content);
    const evolutions = Array.isArray(raw["evolutions"]) ? raw["evolutions"] : [];
    return {
        species: String(raw["species"] ?? "Mysterion").slice(0, 20),
        description: String(raw["description"] ?? ""),
        types: sanitizeTypes(raw["types"]),
        baseStats: clampStats(raw["baseStats"]),
        photoNote: String(raw["photoNote"] ?? ""),
        imagePrompt: String(raw["imagePrompt"] ?? ""),
        evolutions: evolutions.slice(0, evolutionCount).map((e, i) => ({
            name: String(e.name ?? "Evolution").slice(0, 20),
            description: String(e.description ?? ""),
            imagePrompt: String(e.imagePrompt ?? ""),
            statMult: Math.min(1.5, Math.max(1.1, Number(e.statMult) || 1.25)),
            atLevel: i === 0 ? 16 : 32,
        })),
    };
}
// --- sprite generation ------------------------------------------------------
const SPRITE_STYLE = "Retro 16-bit pixel-art monster sprite for a creature-collecting JRPG: full body, " +
    "single creature, centered on a flat pale-cream background, chunky pixels, bold dark " +
    "outline, lively pose, big expressive eyes. No text, no watermark, no humans, no frame.";
async function imageEdit(images, prompt) {
    const form = new FormData();
    form.set("model", IMAGE_MODEL);
    form.set("prompt", prompt);
    form.set("size", "1024x1024");
    form.set("quality", "medium");
    form.set("output_format", "jpeg");
    if (images.length === 1) {
        form.set("image", images[0], "input.jpg");
    }
    else {
        for (const img of images)
            form.append("image[]", img, "input.jpg");
    }
    const res = await fetch(`${API}/images/edits`, {
        method: "POST",
        headers: authHeader(),
        body: form,
    });
    if (!res.ok)
        await fail(res);
    const body = (await res.json());
    const b64 = body.data?.[0]?.b64_json;
    if (!b64)
        throw new OpenAIError(500, "Image response missing data");
    return b64ToBytes(b64);
}
export async function pixelSpriteFromPhoto(photo, spec) {
    const small = await downscaleJpeg(photo, 1024);
    return imageEdit([small], `${SPRITE_STYLE} The creature is "${spec.species}" (${spec.types.join("/")}): ` +
        `${spec.imagePrompt} It is inspired by ${spec.photoNote || "the subject of the photo"} — ` +
        "reinterpret that subject as an original creature, do not reproduce the photo itself.");
}
export async function evolutionSprite(currentSprite, evo, types) {
    return imageEdit([currentSprite], `${SPRITE_STYLE} Evolve the creature in the image into its next form "${evo.name}" ` +
        `(${types.join("/")}): ${evo.imagePrompt} Keep a clear family resemblance (silhouette, ` +
        "colors, motifs) but make it visibly larger, fiercer and more elaborate.");
}
export async function breedSprite(parentA, parentB, offspringName) {
    return imageEdit([parentA, parentB], `${SPRITE_STYLE} These are two parent creatures. Design their offspring "${offspringName}": ` +
        "a single new baby-to-juvenile creature that clearly blends distinctive features, colors " +
        "and motifs from BOTH parents in one coherent body. Slightly smaller and cuter than either parent.");
}
const OFFSPRING_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["species", "description", "types", "baseStats"],
    properties: {
        species: { type: "string" },
        description: { type: "string" },
        types: { type: "array", items: { type: "string", enum: [...TYPE_NAMES] } },
        baseStats: SPEC_SCHEMA.properties.baseStats,
    },
};
export async function breedSpec(a, b) {
    const res = await fetch(`${API}/chat/completions`, {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: JSON.stringify({
            model: CHAT_MODEL,
            max_tokens: 500,
            response_format: {
                type: "json_schema",
                json_schema: { name: "offspring_spec", strict: true, schema: OFFSPRING_SCHEMA },
            },
            messages: [
                {
                    role: "system",
                    content: "You breed pocket monsters. Given two parents (names, types, base stats, " +
                        "descriptions), invent their offspring: a portmanteau-ish new species name, a " +
                        "1-2 sentence description referencing both parents, 1-2 types drawn from the " +
                        "parents' types, and base stats where each stat lies between the parents' " +
                        "values ±15%, clamped to 20-150.",
                },
                { role: "user", content: JSON.stringify({ parentA: a, parentB: b }) },
            ],
        }),
    });
    if (!res.ok)
        await fail(res);
    const body = (await res.json());
    const content = body.choices?.[0]?.message?.content;
    if (!content)
        throw new OpenAIError(500, "Empty model response");
    const raw = JSON.parse(content);
    return {
        species: String(raw["species"] ?? "Hatchling").slice(0, 20),
        description: String(raw["description"] ?? ""),
        types: sanitizeTypes(raw["types"]),
        baseStats: clampStats(raw["baseStats"]),
    };
}
/** Roll 0-2 evolutions: 0 → 25%, 1 → 45%, 2 → 30%. */
export function rollEvolutionCount() {
    const r = Math.random();
    return r < 0.25 ? 0 : r < 0.7 ? 1 : 2;
}
// --- TM: mint a move from a photo -------------------------------------------
const MOVE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["name", "type", "power", "kind", "acc", "flavor"],
    properties: {
        name: { type: "string", description: "Punchy move name, max 18 chars, evocative of the photo subject." },
        type: { type: "string", enum: [...TYPE_NAMES], description: "Elemental type derived from the subject." },
        power: { type: "integer", description: "40 (weak but accurate) to 90 (strong but risky)." },
        kind: { type: "string", enum: ["physical", "special"], description: "physical for impact/force subjects, special for energy/emission/pattern subjects." },
        acc: { type: "number", description: "Accuracy 0.7-1.0; stronger moves should be less accurate." },
        flavor: { type: "string", description: "One sentence: what in the photo became this move." },
    },
};
export async function moveFromPhoto(photo) {
    const dataUrl = await blobToDataUrl(await downscaleJpeg(photo, 768));
    const res = await fetch(`${API}/chat/completions`, {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: JSON.stringify({
            model: CHAT_MODEL,
            max_tokens: 300,
            response_format: {
                type: "json_schema",
                json_schema: { name: "minted_move", strict: true, schema: MOVE_SCHEMA },
            },
            messages: [
                {
                    role: "system",
                    content: "You encode Technical Machines for GoMon, a walk-and-catch monster game. Given a " +
                        "photo a player took, invent ONE battle move inspired by the most distinctive " +
                        "subject in it. Balance is sacred: power 40-90, and accuracy must trade off " +
                        "against power (90 power ⇒ ~0.7-0.8 acc; 40-50 power ⇒ ~0.95-1.0).",
                },
                {
                    role: "user",
                    content: [
                        { type: "text", text: "Mint my move from this photo." },
                        { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
                    ],
                },
            ],
        }),
    });
    if (!res.ok)
        await fail(res);
    const body = (await res.json());
    const content = body.choices?.[0]?.message?.content;
    if (!content)
        throw new OpenAIError(500, "Empty model response");
    const raw = JSON.parse(content);
    const move = sanitizeMove(raw);
    if (!move)
        throw new OpenAIError(500, "Model produced an invalid move");
    return { ...move, flavor: String(raw["flavor"] ?? "") };
}
