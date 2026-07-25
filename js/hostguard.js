// the-league-beta is the lads' pre-season test site: it plays ONLY in the
// sandbox league. Classic (non-module) script so it runs during parse, before
// the sync module computes the league key. Inert on every other host/path.
// External file because the page CSP rightly forbids inline scripts.
if (location.pathname.includes('the-league-beta') && !location.search.includes('sandbox')) {
  // keep whatever else is on the URL (?demo, ?emu=...) — only append sandbox
  var q = location.search ? location.search + '&sandbox' : '?sandbox';
  location.replace(location.pathname + q + location.hash);
}
