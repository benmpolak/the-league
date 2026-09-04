// the-league-beta is the lads' pre-season test site: it plays ONLY in the
// sandbox league. Classic (non-module) script so it runs during parse, before
// the sync module computes the league key. Inert on every other host/path.
// External file because the page CSP rightly forbids inline scripts.
(function () {
  var params = new URLSearchParams(location.search);
  // the preview site (Cunthanger builds for the lads to look at) is the same deal
  var onBeta = location.pathname.includes('the-league-beta') || location.pathname.includes('the-league-preview');
  if (onBeta && !params.has('sandbox')) {
    // keep whatever else is on the URL (?demo, ?emu=...) — only append sandbox
    var q = location.search ? location.search + '&sandbox' : '?sandbox';
    location.replace(location.pathname + q + location.hash);
    return;
  }
  if (!params.has('sandbox')) return;

  /* Both sites serve the SAME files out of the same repo, so the practice
     league installed itself with the real league's name and the real league's
     crest and nobody could tell the two apps apart on a phone (Marc, 13 Aug:
     "they have the same logo so i dont know which is which"). A static mirror
     can't ship a different manifest, so the sandbox swaps to its own here —
     before install, which is when the browser reads it. */
  var swap = function (sel, attr, value) {
    var el = document.querySelector(sel);
    if (el) el.setAttribute(attr, value);
  };
  swap('link[rel="manifest"]', 'href', 'manifest-sandbox.json');
  swap('link[rel="icon"]', 'href', 'icons/icon-sandbox-192.png');
  swap('link[rel="apple-touch-icon"]', 'href', 'icons/icon-sandbox-192.png');
  swap('meta[name="theme-color"]', 'content', '#22e0d2');
  swap('meta[name="apple-mobile-web-app-title"]', 'content', 'League SANDBOX');
  document.addEventListener('DOMContentLoaded', function () {
    document.title = 'SANDBOX — The League';
    var crest = document.querySelector('.brand-crest');
    if (crest) crest.src = 'icons/icon-sandbox-192.png';
  });
})();
