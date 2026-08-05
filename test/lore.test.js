/* The public lore file is deliberately curated from a private chat export.
 * Pin the useful coverage and, more importantly, pin what must never leak. */
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/lore.js', 'utf8');
const ctx = {};
vm.runInNewContext(`${source}\n;globalThis.__lore = { RIVALRIES, MANAGER_LORE, MANAGER_ENTRANCES, FORMER_MANAGERS, CHAT_ARCHIVE, HECKLES };`, ctx);
const lore = ctx.__lore;
let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — ${detail}`}`);
  ok ? pass++ : fail++;
};

const ids = Array.from({ length: 12 }, (_, i) => i + 1);
chk('all twelve current managers have a character note', ids.every(id => typeof lore.MANAGER_LORE[id] === 'string' && lore.MANAGER_LORE[id].length > 30));
chk('all twelve current managers have a unique ceremony entrance',
  ids.every(id => typeof lore.MANAGER_ENTRANCES[id] === 'string' && lore.MANAGER_ENTRANCES[id].length > 40)
  && new Set(Object.values(lore.MANAGER_ENTRANCES)).size === 12);
chk('the established rivalries and former-manager roll are populated', lore.RIVALRIES.length >= 5 && lore.FORMER_MANAGERS.length === 6);
chk('the archive has enough range to rotate rather than repeat', lore.CHAT_ARCHIVE.length >= 10 && new Set(lore.CHAT_ARCHIVE.map(x => x.year)).size >= 3);
chk('draft-night heckles include a restrained dose of the curated League voice', lore.HECKLES.length >= 16 && lore.HECKLES.some(x => /11\.03/.test(x)));

const publicText = JSON.stringify(lore);
const forbidden = [
  /\b(?:\+44|07\d{9})\b/,                            // phone numbers
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,     // emails
  /https?:\/\//i,                                    // links from the export
  /\[\d{2}\/\d{2}\/\d{4},/,                        // WhatsApp timestamps
  /WhatsApp Chat|_chat\.txt/i,
];
chk('no raw-chat identifiers, timestamps, contacts or links enter the public corpus', !forbidden.some(re => re.test(publicText)));
chk('every archive entry is a short paraphrase with valid manager ids', lore.CHAT_ARCHIVE.every(x =>
  Number.isInteger(x.year) && x.year >= 2015 && x.year <= 2026
  && Array.isArray(x.mids) && x.mids.length && x.mids.every(id => ids.includes(id))
  && typeof x.line === 'string' && x.line.length <= 220));

console.log(`\n[lore] ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
