/* The public lore file is deliberately curated from a private chat export.
 * Pin the useful coverage and, more importantly, pin what must never leak. */
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/lore.js', 'utf8');
const ctx = {};
vm.runInNewContext(`${source}\n;globalThis.__lore = { RIVALRIES, MANAGER_LORE, MANAGER_ENTRANCES, FORMER_MANAGERS, CHAT_ARCHIVE, HECKLES, KLAXONS };`, ctx);
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

/* Klaxons. The register is matched on immutable player CODES where it names
   particular men, because ids are positional and move under the feed. A klaxon
   with no mid belongs to the whole room. */
chk('every klaxon has a label and a line', lore.KLAXONS.every(k =>
  typeof k.label === 'string' && k.label.length > 4
  && typeof k.line === 'string' && k.line.length > 10));
chk('a klaxon targets somebody: a manager, a club, a position or named men',
  lore.KLAXONS.every(k => k.mid != null || k.club || k.clubs || k.pos || k.names || k.codes));
chk('manager-scoped klaxons name a real manager',
  lore.KLAXONS.every(k => k.mid == null || ids.includes(k.mid)));
chk('code-matched klaxons carry plausible FPL codes (never feed ids)',
  lore.KLAXONS.filter(k => k.codes).every(k =>
    Array.isArray(k.codes) && k.codes.length
    && k.codes.every(c => Number.isInteger(c) && c > 1000)));
const underage = lore.KLAXONS.find(k => /UNDERAGE/.test(k.label));
chk('the underage klaxon fires for the whole room and names Dowman and Ngumoha by code',
  !!underage && underage.mid == null
  && underage.codes.includes(616077) && underage.codes.includes(611922),
  JSON.stringify(underage));

console.log(`\n[lore] ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
