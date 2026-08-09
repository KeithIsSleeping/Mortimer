#!/usr/bin/env node
/*
 * Rebuild the monster icon references in ../index.html from the test fixtures.
 *
 * WHY: the in-game task-choice icon for a monster is not stable — the same
 * monster can appear in a visibly different pose/frame between task rolls
 * (e.g. Dark beasts looked completely different across captures). A single
 * stored descriptor per monster therefore misfires. This tool stores EVERY
 * distinct captured pose per monster, so matching is robust and grows as you
 * add screenshots.
 *
 * WORKFLOW when the app misidentifies a monster:
 *   1. Save the native screenshot into test/fixtures/ (e.g. 16.png).
 *   2. Add its expected reads to test/ground-truth.json (verify by eye).
 *   3. node rebuild-refs.cjs      # folds any new poses into index.html
 *   4. npm test                   # confirm everything (incl. old fixtures) still passes
 *
 * Ground truth is the single source of the monster labels, so the tool never
 * guesses. Monsters with no fixture keep their existing (wiki-derived) ref.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { PNG } = require('pngjs');

const APP = path.join(__dirname, '..', 'index.html');
const FIXDIR = path.join(__dirname, 'fixtures');
const GT = JSON.parse(fs.readFileSync(path.join(__dirname, 'ground-truth.json'), 'utf8'));

let html = fs.readFileSync(APP, 'utf8');
const rawMatch = html.match(/const ICON_REFS_RAW = (\{.*\});/);
if (!rawMatch) throw new Error('ICON_REFS_RAW not found in index.html');
const existing = JSON.parse(rawMatch[1]);

// expose the app's own descriptor pipeline (function declarations land on window)
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  beforeParse(w) {
    const store = {};
    Object.defineProperty(w, 'localStorage', { configurable: true, value: {
      getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = '' + v; },
      removeItem: k => { delete store[k]; }, clear: () => {} } });
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  }
});
const win = dom.window;

function descOf(a, c) { return { a, c }; }
function dist(A, B) {
  let x = BigInt('0x' + A.a) ^ BigInt('0x' + B.a), ham = 0;
  while (x > 0n) { ham += Number(x & 1n); x >>= 1n; }
  let s = 0; for (let i = 0; i < 192; i++) { const d = A.c[i] - B.c[i]; s += d * d; }
  return ham / 144 + Math.sqrt(s) / (255 * Math.sqrt(192));
}

// extract one descriptor per fixture row, exactly as runOCR would
const captured = {}; // monster -> [{a,c,src}]
for (const key of Object.keys(GT)) {
  if (key.startsWith('_')) continue;
  const png = PNG.sync.read(fs.readFileSync(path.join(FIXDIR, key)));
  const img = { w: png.width, h: png.height, data: png.data };
  const centers = win.detectRows(img);
  const N = Math.min(3, centers.length);
  const rowH = centers.length > 1 ? Math.abs(centers[1] - centers[0]) : Math.floor(img.h / N);
  const stripW = Math.max(24, Math.round(img.w * 0.20));
  for (let i = 0; i < N; i++) {
    const yc = centers[i], y0 = Math.max(0, Math.round(yc - rowH * 0.5)), y1 = Math.min(img.h, Math.round(yc + rowH * 0.5));
    const strip = win._crop(img, 0, y0, stripW, y1 - y0);
    const q = win._descr(win._blob(strip, win._medBG(strip)));
    const name = GT[key].options[i].monster;
    (captured[name] ||= []).push(descOf(q.a.toString(16), q.c));
  }
}

// per monster: keep distinct poses only
const out = { ...existing };
let poses = 0, monstersUpdated = 0;
for (const [name, list] of Object.entries(captured)) {
  const kept = [];
  for (const d of list) if (kept.every(k => dist(k, d) > 0.03)) kept.push({ a: d.a, c: d.c });
  out[name] = kept;
  poses += kept.length; monstersUpdated++;
  console.log(`${name}: ${list.length} capture(s) -> ${kept.length} pose(s)`);
}

const newRawLine = 'const ICON_REFS_RAW = ' + JSON.stringify(out) + ';';
const beforeRaw = html;
html = html.replace(/const ICON_REFS_RAW = \{.*\};/, () => newRawLine);

// ensure the loader flattens arrays of poses
const oldLoader = 'const ICON_REFS = Object.entries(ICON_REFS_RAW).map(([n,d])=>({name:n,a:BigInt("0x"+d.a),c:d.c}));';
const newLoader = 'const ICON_REFS = Object.entries(ICON_REFS_RAW).flatMap(([n,v])=>(Array.isArray(v)?v:[v]).map(d=>({name:n,a:BigInt("0x"+d.a),c:d.c})));';
if (html.includes(oldLoader)) html = html.replace(oldLoader, newLoader);
else if (!html.includes(newLoader)) throw new Error('icon loader line not found — did the source change?');

const changed = html !== beforeRaw;
fs.writeFileSync(APP, html, 'utf8');
console.log(`\n${monstersUpdated} monsters from fixtures, ${poses} distinct poses; wiki refs kept for uncaptured monsters.`);
console.log(changed ? 'index.html updated.' : 'index.html unchanged (already up to date).');
