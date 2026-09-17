/* The deploy-time asset stamp (Marc, 17 Sept 2026: "i just see the previous
 * version, the draft list and positions and nothing more" — hours after that
 * deploy had gone green).
 *
 * This runs on the deploy path, so it is worth more than a glance:
 *   - every plain .js/.css tag gets a hash, or the build is refused
 *   - the hash follows the FILE, not the commit, because the FPL refresh
 *     deploys every five minutes and a commit stamp would hand all 800KB of
 *     app.js a new URL on each one
 *   - a file that did not change keeps its URL, so nothing is re-fetched
 *   - absolute, data: and already-queried URLs are left alone
 *   - and the real index.html actually stamps, which is the one that matters
 *
 * Node only, no browser. Usage: node test/stamp.test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stamp } = require('../scripts/stamp_build.js');

let passed = 0;
const check = (name, fn) => {
  try { fn(); console.log('PASS ' + name); passed++; }
  catch (e) { console.log('FAIL ' + name + ' — ' + e.message); process.exitCode = 1; }
};

// a little fake site: index.html plus the files it points at
const files = {
  'js/app.js': 'the app, version one',
  'css/style.css': 'body { color: red }',
  'js/sync.js': 'export const x = 1',
};
const read = rel => {
  if (!(rel in files)) throw Object.assign(Error('ENOENT'), { code: 'ENOENT' });
  return Buffer.from(files[rel]);
};
const page = `<!doctype html>
<link rel="stylesheet" href="css/style.css">
<script src="js/app.js"></script>
<script type="module" src="js/sync.js"></script>`;

check('every plain asset tag is stamped', () => {
  const { out, seen } = stamp(page, read);
  assert.strictEqual(seen.length, 3);
  for (const { rel, v } of seen) {
    assert.match(v, /^[a-f0-9]{12}$/, `${rel} hash looks wrong: ${v}`);
    assert.ok(out.includes(`${rel}?v=${v}`), `${rel} not rewritten`);
  }
  assert.ok(!/href="css\/style\.css"/.test(out) && !/src="js\/app\.js"/.test(out), 'an unstamped tag survived');
});

check('the hash is of the file, so a changed file gets a new URL', () => {
  const before = stamp(page, read).seen.find(x => x.rel === 'js/app.js').v;
  const after = stamp(page, rel => Buffer.from(rel === 'js/app.js' ? 'the app, version TWO' : files[rel])).seen
    .find(x => x.rel === 'js/app.js').v;
  assert.notStrictEqual(before, after);
});

/* The one that protects the league's mobile data. The FPL refresh deploys
   every five minutes around the clock; if the stamp came from the commit,
   every one of those would give app.js a URL nobody had cached and every
   manager would re-download the whole app, all day. */
check('a deploy that changed nothing leaves every URL exactly as it was', () => {
  const a = stamp(page, read).out;
  const b = stamp(page, read).out;
  assert.strictEqual(a, b);
});
check('and changing one file leaves the OTHER files\' URLs untouched', () => {
  const before = stamp(page, read).seen;
  const after = stamp(page, rel => Buffer.from(rel === 'js/app.js' ? 'changed!' : files[rel])).seen;
  const unchanged = ['css/style.css', 'js/sync.js'];
  for (const rel of unchanged) {
    assert.strictEqual(after.find(x => x.rel === rel).v, before.find(x => x.rel === rel).v, rel + ' moved');
  }
  assert.notStrictEqual(after.find(x => x.rel === 'js/app.js').v, before.find(x => x.rel === 'js/app.js').v);
});

check('an absolute URL is left alone', () => {
  const html = '<script src="https://cdn.example.com/x.js"></script><script src="//other/y.js"></script>';
  const { out, seen } = stamp(html, read);
  assert.strictEqual(seen.length, 0);
  assert.strictEqual(out, html);
});
check('a tag that already carries a query is left alone', () => {
  const html = '<script src="js/app.js?t=123"></script>';
  const { out } = stamp(html, read);
  assert.strictEqual(out, html);
});
check('a tag pointing at a file we do not have is left alone, not broken', () => {
  const html = '<script src="js/missing.js"></script>';
  const { out, seen } = stamp(html, read);
  assert.strictEqual(seen.length, 0);
  assert.strictEqual(out, html);
});
check('stamping twice does not double-stamp', () => {
  const once = stamp(page, read).out;
  const twice = stamp(once, read).out;
  assert.strictEqual(twice, once);
  assert.ok(!/\?v=[a-f0-9]+\?v=/.test(twice));
});

/* ----- and the real page, which is the only one that ships ----- */
const realPage = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
check('the real index.html stamps every asset it loads', () => {
  const { out, seen } = stamp(realPage, rel => fs.readFileSync(path.join(__dirname, '..', rel)));
  const tags = (realPage.match(/\b(?:src|href)="(?!https?:|\/\/|data:)[^"?#]+\.(?:js|css)"/g) || []).length;
  assert.ok(tags >= 10, `expected the real page to load a dozen assets, found ${tags}`);
  assert.strictEqual(seen.length, tags, `${tags} tags but ${seen.length} stamped`);
  assert.ok(seen.some(x => x.rel === 'js/app.js'), 'app.js of all things was not stamped');
  // the watchdog reads its own build out of this exact shape, so the shape is
  // part of the contract and not an implementation detail
  assert.match(out, /src="js\/app\.js\?v=[a-f0-9]{12}"/);
});
/* The two halves have to agree, and they live in different files: the stamper
   writes the URL, the watchdog reads it back. So lift the watchdog's own
   pattern straight out of app.js and run it against what the stamper actually
   produced. If either side is ever reworded alone, this is what notices. */
check('the watchdog looks for the shape the stamper writes', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  // anchored to servedBuild, not to the first .match() in fifteen thousand
  // lines — which is a date parser and passed for the wrong reason
  const fn = app.slice(app.indexOf('async function servedBuild()'));
  assert.ok(fn.startsWith('async function servedBuild()'), 'servedBuild has been renamed or removed');
  const m = fn.slice(0, fn.indexOf('\n}')).match(/\.match\(\/(.+?)\/\)/);
  assert.ok(m, 'could not find the watchdog\'s index.html pattern inside servedBuild');
  const { out } = stamp(realPage, rel => fs.readFileSync(path.join(__dirname, '..', rel)));
  const re = new RegExp(m[1]);
  assert.ok(re.test(out), `the watchdog reads /${m[1]}/ which does not match what the stamper writes`);
  // and it captures the hash, not merely finds the line
  assert.match(out.match(re)[1], /^[a-f0-9]{12}$/);
});
check('and it falls back rather than breaking on an unstamped page', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.ok(/if \(APP_BUILD\) \{/.test(app), 'no stamped branch');
  assert.ok(/method: 'HEAD', cache: 'no-store'/.test(app), 'the unstamped fallback is gone');
});

console.log(`\n[stamp] ${passed} passed, ${process.exitCode ? 'some' : 0} failed`);
