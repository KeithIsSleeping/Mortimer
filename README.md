# Mortimer — OSRS Slayer task advisor

A single-page, **fully offline** calculator that helps you pick the best task from
[Mortimer](https://oldschool.runescape.wiki/w/Mortimer), the Slayer master, with a focus on the
**imbued heart** grind. Paste or upload a screenshot of the *Slayer Task Choice* window and it will:

- identify each offered monster by its **icon**,
- read the **modifier** type (XP / quantity / points / superior-unique / clue) and its value straight off the pill,
- score every option for your chosen goal (imbued heart, Slayer XP, or points),
- recommend which task to take, which **bracelet** to wear (Slaughter vs Expeditious), whether to **reroll**, and whether to **repeat** the task if the Slayer cape offers it.

**Live site:** https://keithissleeping.github.io/Mortimer/

Everything runs in your browser. No accounts, no servers, no network calls — your screenshots never leave your machine.

## Why it exists

Many guides claim Mortimer beats Duradel + Turael-skipping for the imbued heart. This tool models the
real numbers — superior spawn rates, per-monster kills/hr, block slots, bracelet effects, the Slayer-cape
repeat, and Mortimer's task-count unlocks — so you can make the call for **your** account instead of trusting a rule of thumb.

The heart-per-superior formula it uses is the wiki one:

```
heart / superior = 1 / (8 · (200 − ⌊(req + 55)² / 125⌋))
```

Rates are per hour and independent of task size; task size only sets how long a task lasts.

## How the screenshot reader works (offline OCR)

There is no external OCR dependency. The pipeline (`index.html`) is:

1. **`detectRows`** — finds the dark task pills to count how many tasks (2 or 3) are offered.
2. **`classifyIcon`** — matches the monster sprite against pre-computed reference descriptors (12×12 average-hash + 8×8 colour). The in-game icon is a live-rendered model and can appear in a **different pose/frame between task rolls**, so each monster stores *multiple* reference poses (built from the fixtures); a match against any pose wins. If the icon match is **uncertain** (an unseen pose), the reader falls back to `readHeaderText`, which reads the orange monster-name text via embedded **b12 cache-font** letter templates and keyword-matches it — the icon is never overridden when it is confident.
3. **`classifyBadge`** — reads the circular modifier badge to determine the modifier *type*.
4. **`readPillValue`** — segments the pill text and template-matches digits against embedded RuneLite cache-font glyphs to read the *value* (snapped to a multiple of 5; supports negatives).

Because the monster/modifier reference data is embedded, adding or fixing a monster is a data change, not a
model change.

## Kills-per-hour data

OSRS has **no** authoritative crowdsourced per-monster kills/hr dataset (the wiki publishes Slayer-XP/kill and
cannon/multicombat flags but not XP/hr; TempleOSRS covers bosses and aggregate skilling only). The tool ships
**method-tagged estimates** grounded in the wiki strategy pages and lets you **override any rate**; your edits
persist locally (and export/import as JSON). Dial in your real rates once and the recommendations follow.

## Development

The app is a single self-contained file: **`index.html`**. Open it directly in a browser — no build step.

```
index.html                 the whole app (HTML + CSS + JS, no external assets)
test/
  run.cjs                  jsdom harness that runs the real OCR pipeline headlessly
  rebuild-refs.cjs         folds new monster icon poses from the fixtures into index.html
  ground-truth.json        human-verified expected reads for each fixture
  fixtures/*.png           native in-game "Slayer Task Choice" screenshots
.github/workflows/deploy.yml   runs the tests, then deploys to Pages if they pass
```

### Running the OCR regression tests

```bash
cd test
npm install
npm test
```

The harness loads `index.html` in [jsdom](https://github.com/jsdom/jsdom), shims a headless `<canvas>` and
`Image` backed by the decoded fixture pixels, runs the **real** `runOCR` pipeline on every fixture, and asserts
the detected monster, modifier type, and modifier value against `ground-truth.json`. It fails on any mismatch
or any uncaught page error. **Run it after every change to the OCR code, the reference data, or anything else in
`index.html`.**

### Adding a test fixture

1. Drop a native *Slayer Task Choice* screenshot into `test/fixtures/` (e.g. `16.png`). Use a clean game
   screenshot — not a screenshot of this app.
2. Add its expected reads to `test/ground-truth.json` (verify them **by eye**, never by trusting the current reader).
3. `npm test`.

### Fixing a misidentified monster

The task-choice icon for a monster isn't stable — the same monster can render in a noticeably different pose
between task rolls, so a single stored descriptor can misfire. When the app picks the wrong monster:

1. Save the native screenshot into `test/fixtures/` and add its ground truth (as above).
2. `node rebuild-refs.cjs` — this extracts each fixture icon's descriptor with the app's own pipeline and folds
   any **new distinct poses** into `index.html`'s `ICON_REFS_RAW` (existing poses and uncaptured monsters are
   preserved). It's idempotent.
3. `npm test` — confirm the new shot **and** every earlier fixture still pass.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which runs the OCR suite and, only if it passes,
publishes `index.html` to GitHub Pages. A failing test blocks the deploy.

## License

MIT — see [LICENSE](LICENSE).

Old School RuneScape and all related assets are property of Jagex Ltd. This is an unofficial fan tool; game
mechanics are grounded in the [OSRS Wiki](https://oldschool.runescape.wiki/).
