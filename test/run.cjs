#!/usr/bin/env node
/*
 * Mortimer OCR regression suite.
 *
 * Loads ../index.html in jsdom, shims a headless <canvas>/Image so the app's
 * real screenshot pipeline (detectRows -> classifyIcon -> classifyBadge ->
 * readPillValue -> runOCR) runs unchanged, then feeds each fixture PNG and
 * asserts the resulting option boxes against test/ground-truth.json.
 *
 * Run:  npm test   (from the test/ directory)
 * Exit: 0 = all assertions passed and no page errors; 1 = any failure.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { PNG } = require('pngjs');

const ROOT = __dirname;
const APP = path.join(ROOT, '..', 'index.html');
const FIXDIR = path.join(ROOT, 'fixtures');
const GT = JSON.parse(fs.readFileSync(path.join(ROOT, 'ground-truth.json'), 'utf8'));

if (!fs.existsSync(APP)) { console.error('Cannot find app at ' + APP); process.exit(2); }
const html = fs.readFileSync(APP, 'utf8');

// ---- decode every fixture referenced by the ground truth ----
const shots = {};
for (const key of Object.keys(GT)) {
  if (key.startsWith('_')) continue;
  const p = path.join(FIXDIR, key);
  if (!fs.existsSync(p)) { console.error('Missing fixture: ' + p); process.exit(2); }
  const png = PNG.sync.read(fs.readFileSync(p));
  shots[key] = { w: png.width, h: png.height, data: png.data };
}

// ---- a minimal 2D canvas backed by the decoded fixture pixels ----
function makeCanvas() {
  let W = 0, H = 0, img = null;
  const ctx = {
    imageSmoothingEnabled: false,
    drawImage(image) { img = image; },
    getImageData(x, y, w, h) {
      const s = img && img._pixels;
      const out = new Uint8ClampedArray(w * h * 4);
      if (s) {
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          const sx = x + i, sy = y + j, di = (j * w + i) * 4;
          if (sx >= 0 && sy >= 0 && sx < s.w && sy < s.h) {
            const si = (sy * s.w + sx) * 4;
            out[di] = s.data[si]; out[di + 1] = s.data[si + 1];
            out[di + 2] = s.data[si + 2]; out[di + 3] = s.data[si + 3];
          }
        }
      }
      return { data: out, width: w, height: h };
    }
  };
  return {
    get width() { return W; }, set width(v) { W = v; },
    get height() { return H; }, set height(v) { H = v; },
    getContext() { return ctx; }
  };
}

const pageErrors = [];

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(window) {
    // localStorage: a real in-memory mock (jsdom's own is fine too, but force determinism)
    const store = {};
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; },
        clear: () => { for (const k in store) delete store[k]; }
      }
    });
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    window.alert = () => {};
    window.confirm = () => true;

    // Image whose src="blob:<key>" resolves to a pre-decoded fixture
    class FakeImage {
      constructor() { this.onload = null; this.onerror = null; this.width = 0; this.height = 0; this._pixels = null; }
      set src(v) {
        const key = String(v).replace('blob:', '');
        const s = shots[key];
        if (!s) { if (this.onerror) setTimeout(() => this.onerror(new Error('no fixture ' + key)), 0); return; }
        this._pixels = s; this.width = s.w; this.height = s.h;
        if (this.onload) setTimeout(() => this.onload(), 0);
      }
    }
    window.Image = FakeImage;

    if (!window.URL) window.URL = {};
    window.URL.createObjectURL = f => 'blob:' + ((f && f._key) || '');
    window.URL.revokeObjectURL = () => {};

    const origCreate = window.document.createElement.bind(window.document);
    window.document.createElement = (tag, ...rest) =>
      String(tag).toLowerCase() === 'canvas' ? makeCanvas() : origCreate(tag, ...rest);

    window.addEventListener('error', e => pageErrors.push(e.error ? e.error.message : e.message));
  }
});

const win = dom.window;
const doc = win.document;
const $ = sel => [...doc.querySelectorAll(sel)];

function readOptions() {
  const names = $('#optionInputs .oName').map(s => s.value);
  const types = $('#optionInputs .oMod').map(s => s.value);
  const vals = $('#optionInputs .oVal').map(s => (s.value === '' ? null : Number(s.value)));
  return names.map((monster, i) => ({ monster, type: types[i], value: vals[i] }));
}

// ---- assertions ----
let pass = 0, fail = 0;
const failLines = [];
function eq(label, got, want) {
  if (got === want) { pass++; }
  else { fail++; failLines.push(`  FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}

(async () => {
  // sanity: the app initialised without throwing
  if (!win.runOCR) { console.error('runOCR is not defined on window — app failed to initialise'); process.exit(2); }

  const files = Object.keys(GT).filter(k => !k.startsWith('_'));
  for (const key of files) {
    const gt = GT[key];
    const before = pass + fail;
    try {
      await win.runOCR({ _key: key, name: key, type: 'image/png' });
    } catch (e) {
      fail++; failLines.push(`  FAIL ${key}: runOCR threw ${e.message}`);
      continue;
    }
    const got = readOptions();
    eq(`${key} rows`, got.length, gt.n);
    for (let i = 0; i < gt.n; i++) {
      const g = got[i] || {};
      const w = gt.options[i];
      eq(`${key}[${i + 1}] monster`, g.monster, w.monster);
      eq(`${key}[${i + 1}] type`, g.type, w.type);
      eq(`${key}[${i + 1}] value`, g.value, w.value);
    }
    const localFails = failLines.filter(l => l.includes(`${key}`)).length;
    const okShots = (pass + fail - before);
    const readback = got.slice(0, gt.n).map(o => `${o.monster}[${o.type}:${o.value}]`).join(', ');
    console.log(`${localFails ? 'FAIL' : 'ok  '} ${key}  (${gt.n} tasks)  ${readback}`);
  }

  console.log('');
  if (failLines.length) { console.log(failLines.join('\n')); console.log(''); }

  const clean = pageErrors.length === 0;
  if (!clean) console.log('PAGE ERRORS: ' + pageErrors.join(' | '));
  else console.log('page errors: none');

  console.log(`\n${pass} passed, ${fail} failed across ${files.length} fixtures (${pass + fail} assertions).`);
  process.exit(fail === 0 && clean ? 0 : 1);
})().catch(e => { console.error('Harness error: ' + e.stack); process.exit(2); });
