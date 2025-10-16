// gen-art.cjs — Genera 1000 PNGs (512×512) con Twemoji (SVG/PNG multi-CDN),
// compone el emoji como bitmap (robusto), crea metadatas y sube a Pinata.
// Reqs: @pinata/sdk dotenv axios sharp twemoji

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios').default;
const sharp = require('sharp');
const pinataSDK = require('@pinata/sdk');
const twemoji = require('twemoji');

// ─────────────────────────────────────────────────────────────────────────────
// Config visual
const CANVAS = 512;          // tamaño final de imagen
const EMOJI_SIZE = 360;      // tamaño del emoji dentro del canvas
const CAPTION_SIZE = 22;     // tamaño del texto inferior

// ─────────────────────────────────────────────────────────────────────────────
// Pinata Auth (JWT preferido; fallback API Key + Secret)
const PINATA_JWT = (process.env.PINATA_JWT || '').trim();
const PINATA_API_KEY = (process.env.PINATA_API_KEY || '').trim();
const PINATA_API_SECRET = (process.env.PINATA_API_SECRET || '').trim();

function isValidJWT(t) { return typeof t === 'string' && t.split('.').length === 3 && !t.includes('\n') && t.length > 20; }

let pinata;
if (isValidJWT(PINATA_JWT)) {
  console.log('🔐 Pinata auth: JWT');
  pinata = new pinataSDK({ pinataJWTKey: PINATA_JWT });
} else if (PINATA_API_KEY && PINATA_API_SECRET) {
  console.log('🔑 Pinata auth: API Key + Secret');
  pinata = new pinataSDK(PINATA_API_KEY, PINATA_API_SECRET);
} else {
  console.error('❌ Faltan credenciales en .env (PINATA_JWT o PINATA_API_KEY + PINATA_API_SECRET)');
  process.exit(1);
}

async function assertAuth() {
  try {
    const res = await pinata.testAuthentication();
    console.log('✅ Autenticación OK:', res?.message || res);
  } catch (e) {
    console.error('❌ Error autenticando con Pinata:', e?.response?.data || e?.message || e);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rutas / carpetas
const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, 'out');
const IMG_DIR = path.join(OUT_DIR, 'images');
const META_DIR = path.join(OUT_DIR, 'metadata');

function ensureDirs() {
  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.mkdirSync(META_DIR, { recursive: true });
}
function emptyDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) { emptyDir(p); fs.rmdirSync(p); }
    else fs.unlinkSync(p);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rarezas y arte
const COMMON_EMOJIS = ['🎃','👻','🦇','💀','🕸️','🕷️','🫥','🪦','🪄'];
const DRACULA = '🧛', WITCH = '🧙‍♀️', ZOMBIE = '🧟';

function pickDisjointRares(total, perType) {
  const pool = Array.from({ length: total }, (_, i) => i + 1);
  function take(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      out.push(pool.splice(idx, 1)[0]);
    }
    return out;
  }
  return { draculas: take(perType), witches: take(perType), zombies: take(perType) };
}

function palette(id) {
  const hues = [20, 35, 280, 260, 200, 150, 340];
  const h = hues[id % hues.length];
  return {
    bg1: `hsl(${h},80%,12%)`,
    bg2: `hsl(${(h + 30) % 360},80%,8%)`,
    accent: `hsl(${(h + 10) % 360},95%,55%)`
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Twemoji fetch multi-CDN (SVG con/sin -fe0f → PNG 72x72 fallback)
const TWEMOJI_VER = '14.0.2';
const UA = { 'User-Agent': 'halloween-nft-gen/1.0' };

function emojiToCodepoint(emojiChar) {
  return twemoji.convert.toCodePoint(emojiChar); // ej: "1f578-fe0f"
}
async function fetchText(url) {
  const res = await axios.get(url, { responseType: 'text', timeout: 10000, headers: UA, validateStatus: () => true });
  if (res.status >= 200 && res.status < 300) return res.data;
  return null;
}
async function fetchBuffer(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000, headers: UA, validateStatus: () => true });
  if (res.status >= 200 && res.status < 300) return Buffer.from(res.data);
  return null;
}
async function fetchTwemojiAsset(emojiChar) {
  const cpRaw  = emojiToCodepoint(emojiChar);
  const cpBase = cpRaw.replace(/-fe0f$/i, '');

  const svgUrls = [
    `https://cdn.jsdelivr.net/npm/twemoji@${TWEMOJI_VER}/assets/svg/${cpRaw}.svg`,
    `https://cdn.jsdelivr.net/npm/twemoji@${TWEMOJI_VER}/assets/svg/${cpBase}.svg`,
    `https://unpkg.com/twemoji@${TWEMOJI_VER}/assets/svg/${cpRaw}.svg`,
    `https://unpkg.com/twemoji@${TWEMOJI_VER}/assets/svg/${cpBase}.svg`,
    `https://raw.githubusercontent.com/twitter/twemoji/v${TWEMOJI_VER}/assets/svg/${cpRaw}.svg`,
    `https://raw.githubusercontent.com/twitter/twemoji/v${TWEMOJI_VER}/assets/svg/${cpBase}.svg`
  ];
  for (const u of svgUrls) {
    const svg = await fetchText(u);
    if (svg) return { svgMarkup: svg };
  }

  const pngUrls = [
    `https://cdn.jsdelivr.net/npm/twemoji@${TWEMOJI_VER}/assets/72x72/${cpBase}.png`,
    `https://unpkg.com/twemoji@${TWEMOJI_VER}/assets/72x72/${cpBase}.png`,
    `https://raw.githubusercontent.com/twitter/twemoji/v${TWEMOJI_VER}/assets/72x72/${cpBase}.png`
  ];
  for (const u of pngUrls) {
    const buf = await fetchBuffer(u);
    if (buf) return { pngBuf: buf };
  }

  throw new Error(`Twemoji asset not found for emoji ${emojiChar} (cp=${cpRaw})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Render helpers (COMPOSITE)
async function makeBackgroundPNG({ id, accent, bg1, bg2 }) {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg1}"/>
      <stop offset="100%" stop-color="${bg2}"/>
    </linearGradient>
    <style>.cap{font:700 ${CAPTION_SIZE}px system-ui,-apple-system,Segoe UI,Roboto;fill:${accent}}</style>
  </defs>
  <rect width="${CANVAS}" height="${CANVAS}" fill="url(#bg)"/>
  <text x="50%" y="${CANVAS - 20}" text-anchor="middle" class="cap">Halloween Spooks #${id}</text>
</svg>`.trim();
  return await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

async function rasterizeEmoji(asset, sizePx) {
  if (asset.svgMarkup) {
    return await sharp(Buffer.from(asset.svgMarkup))
      .resize(sizePx, sizePx, { fit: 'contain' })
      .png()
      .toBuffer();
  }
  return await sharp(asset.pngBuf)
    .resize(sizePx, sizePx, { fit: 'contain' })
    .png()
    .toBuffer();
}

async function renderEmojiPNG({ id, emoji, rarity, outPath }) {
  const { bg1, bg2, accent } = palette(id);
  const base = await makeBackgroundPNG({ id, accent, bg1, bg2 });
  const asset = await fetchTwemojiAsset(emoji);

  const left = Math.round((CANVAS - EMOJI_SIZE) / 2);
  const top  = Math.round((CANVAS - EMOJI_SIZE) / 2) - (rarity === 'Legendary' ? 6 : 0);

  let emojiPng = await rasterizeEmoji(asset, EMOJI_SIZE);

  if (rarity === 'Legendary') {
    const glow = await sharp(emojiPng).blur(12).modulate({ brightness: 1.2, saturation: 1.1 }).png().toBuffer();
    const withGlow = await sharp(base)
      .composite([{ input: glow, left, top, blend: 'screen' }])
      .png().toBuffer();
    await sharp(withGlow).composite([{ input: emojiPng, left, top }]).png().toFile(outPath);
    return;
  }

  await sharp(base).composite([{ input: emojiPng, left, top }]).png().toFile(outPath);
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata
function metadataJson({ id, imageCid, rarity, emoji }) {
  return {
    name: `Halloween Spooks #${id}`,
    description: `Halloween NFT #${id} (${rarity}) — ${emoji}`,
    image: `ipfs://${imageCid}/${id}.png`,
    attributes: [
      { trait_type: "Series", value: "Halloween Spooks" },
      { trait_type: "ID", value: id },
      { trait_type: "Emoji", value: emoji },
      { trait_type: "Rarity", value: rarity }
    ]
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pin helpers
async function pinFolder(dirPath, name) {
  const entries = fs.readdirSync(dirPath);
  if (entries.length === 0) throw new Error(`La carpeta ${dirPath} está vacía`);
  const res = await pinata.pinFromFS(dirPath, {
    pinataMetadata: { name },
    pinataOptions: { cidVersion: 1 }
  });
  return res.IpfsHash;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
(async function main() {
  await assertAuth();

  ensureDirs();
  emptyDir(IMG_DIR);
  emptyDir(META_DIR);

  console.log('🎨 Generando 1000 PNGs (512×512) con rareza 3/3/3…');
  const total = 100;
  const { draculas, witches, zombies } = pickDisjointRares(total, 3);
  console.log('🧛 Dráculas:', draculas);
  console.log('🧙‍♀️ Brujas:',  witches);
  console.log('🧟 Zombis:',   zombies);

  // 1) Render PNGs
  for (let id = 1; id <= total; id++) {
    let emoji = COMMON_EMOJIS[(id - 1) % COMMON_EMOJIS.length];
    let rarity = 'Common';
    if (draculas.includes(id)) { emoji = DRACULA; rarity = 'Legendary'; }
    else if (witches.includes(id)) { emoji = WITCH; rarity = 'Legendary'; }
    else if (zombies.includes(id)) { emoji = ZOMBIE; rarity = 'Legendary'; }

    const outPath = path.join(IMG_DIR, `${id}.png`);
    await renderEmojiPNG({ id, emoji, rarity, outPath });
  }

  // 2) Subir imágenes
  console.log('⬆️ Subiendo out/images a Pinata…');
  const imagesCid = await pinFolder(IMG_DIR, `halloween-images-512-${Date.now()}`);
  console.log('📁 IMAGES CID:', imagesCid);
  console.log('🔗 Ej: https://gateway.pinata.cloud/ipfs/' + imagesCid + '/images/1.png');

  // 3) Metadatas que apuntan al IMAGES CID
  console.log('📝 Generando metadatas…');
  for (let id = 1; id <= total; id++) {
    let emoji = COMMON_EMOJIS[(id - 1) % COMMON_EMOJIS.length];
    let rarity = 'Common';
    if (draculas.includes(id)) { emoji = DRACULA; rarity = 'Legendary'; }
    else if (witches.includes(id)) { emoji = WITCH; rarity = 'Legendary'; }
    else if (zombies.includes(id)) { emoji = ZOMBIE; rarity = 'Legendary'; }

    const meta = metadataJson({ id, imageCid: imagesCid, rarity, emoji });
    fs.writeFileSync(path.join(META_DIR, `${id}.json`), JSON.stringify(meta, null, 2), 'utf8');
  }

  // 4) Subir metadatas
  console.log('⬆️ Subiendo out/metadata a Pinata…');
  const metadataCid = await pinFolder(META_DIR, `halloween-metadata-${Date.now()}`);

  console.log('\n✅ Listo!');
  console.log('🖼️  IMAGES  CID:', imagesCid);
  console.log('📦 METADATA CID:', metadataCid);
  console.log('🔗 baseURI para el contrato: ipfs://' + metadataCid + '/metadata/');
})().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});