# Club Inbox and the cuttings file

Ben's brief: give the existing assistants distinct voices and let media
stories develop across rounds. His qualification matters: build it only
where it improves the game. A quiet week produces no task.

## What creates correspondence

At most one answered item per manager per regular-season gameweek:

- A recent unresolved reporter ban or dispute with the assistant.
- Three or more consecutive settled defeats.
- An actual press-room boast, manager-written answer or storm-out from the
  preceding four rounds, unless already addressed in the inbox.
- Three or more recorded arrivals for the current round.

The available responses belong to that incident. A ban keeps Ornsteak in
the car park; blaming the assistant produces a meeting request. Doubling
down preserves the dispute; clearing the air ends it. Unanswered disputes
stop prompting after a short window. Participation is optional. Nothing
changes squads, points, waivers or access to the real press-room UI.

## Cast and publication

`js/club-media.js` contains the shared generator and voices for all twelve
existing selectable assistants. The roster order is pinned against
`js/lore.js`. Custom assistants keep their names and use neutral lines.
Their voices also appear in My Team and the Gazette's dressing-room column.

The manager selects an exact statement and presses **Put it on record**.
It becomes public correspondence: the feed reports it, the paper carries it,
and previous correspondence remains available in Media. The cuttings file
revisits actual earlier pressers and counts only settled subsequent results.
Free text is quoted verbatim, never interpreted as a promise or confession.
Only three old stories are featured per round, rotated deterministically.

## State and release

`public/mediaCases/{managerId}/{gwIndex}` holds the server-generated incident,
choice, exact statement, reply and consequence. `mediaRespond` derives the
actor from membership, regenerates the offered case inside a public-node
transaction, and accepts only the current round and a valid option. Exact
retries return the original record; conflicting responses cannot both land.
No browser supplies publishable narrative or reads private waiver plans.

The node participates in shared snapshots, exports and restore validation.
Old exports without it remain valid. Firebase's numeric-map array coercion
is handled for both correspondence and press conferences.

`scripts/copy_engine.js` copies the shared media module into Functions for
emulator runs and deployments. The website release manifest includes its
expected hash. Deploy Functions before publishing the website; verify the
deployed copy as well as `index.js`, `engine.js` and `feedcheck.js`.

Tests: `club-media.test.js`, `club-media.server.test.js` and
`club-media.smoke.js`, included in the normal offline, emulator and browser
suites. The browser smoke checks phone widths, escaped quotes, next-week
follow-ups and preservation of the selected response after a failed send.
