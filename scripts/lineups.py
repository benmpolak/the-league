#!/usr/bin/env python3
"""Match a predicted-line-up source's player names onto our own player ids.

Marc, 24 Aug 2026, wants the projection weighted by Fantasy Football Scout's
predicted XIs rather than by our own start history alone. This module is the
part that decides whether any of that can work: their names against ours.

It is where these integrations really die. Our web_name is not their name and
neither is our `full`:

    B.Fernandes    is  Bruno Borges Fernandes   they write  Bruno Fernandes
    B.Badiashile   is  Benoît Badiashile Mukinayi           Benoit Badiashile
    Arrizabalaga   is  Kepa Arrizabalaga Revuelta           Kepa
    Van den Berg   is  Sepp van den Berg
    Milosavljević  is  Veljko Milosavljevic     (our own two spellings differ)

So first-plus-last does not work, last-token-is-the-surname does not work, and
exact matching on either of our fields does not work. Instead every player
offers a SET of keys he would answer to, and a name matches if it hits any of
them. Keys that two men at the same club would both answer to are struck out
before matching rather than guessed between — a wrong id here silently credits
one manager's projection with another man's afternoon.

Matching is always scoped to a club. Their page carries a team code per block,
and without that scoping a bare surname is far too dangerous.

No network. Import it, or run it to see how well it covers today's feed:
    python3 scripts/lineups.py
"""
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# NFKD splits an accent off its letter, but a handful of footballing letters
# are not accents at all and survive it. Anyone called Hjertø-Dahl or
# Muharemović has to land on the same key as the page that spells him plainly.
FOLD = str.maketrans({
    'ø': 'o', 'Ø': 'o', 'æ': 'ae', 'Æ': 'ae', 'å': 'a', 'Å': 'a',
    'ð': 'd', 'Ð': 'd', 'þ': 'th', 'Þ': 'th', 'ł': 'l', 'Ł': 'l',
    'đ': 'd', 'Đ': 'd', 'ı': 'i', 'ß': 'ss', 'œ': 'oe', 'Œ': 'oe',
})


def norm(s):
    """Lower-case, strip accents and punctuation, collapse the spaces."""
    if not s:
        return ''
    s = str(s).translate(FOLD)
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-zA-Z0-9]+", ' ', s.lower())
    return re.sub(r'\s+', ' ', s).strip()


def keys_for(player):
    """Every name this man would plausibly be printed under."""
    keys = set()
    full = norm(player.get('full'))
    web = norm(player.get('name'))
    for k in (full, web):
        if k:
            keys.add(k)
    # "b fernandes" -> "fernandes": our feed abbreviates a first name to an
    # initial when two men share a surname, and no page anywhere copies that
    if web:
        stripped = re.sub(r'^[a-z] ', '', web)
        if stripped != web and len(stripped) >= 4:
            keys.add(stripped)
    toks = full.split()
    # first name paired with each later part. Badiashile is the SECOND of three
    # words, Fernandes the third — a first-and-last rule misses one of them
    if len(toks) >= 2:
        for t in toks[1:]:
            keys.add(f'{toks[0]} {t}')
        # ...and the tail on its own: "van den berg" out of "sepp van den berg"
        for i in range(1, len(toks)):
            tail = ' '.join(toks[i:])
            if len(tail) >= 4:
                keys.add(tail)
    # single words, for the pages that print "Kepa" and mean Kepa
    for t in toks + web.split():
        if len(t) >= 4:
            keys.add(t)
    keys = {k for k in keys if len(k) >= 4}
    # ...but the feed's own short name is the canonical one and goes in whatever
    # its length. Four men were unreachable without this — Eze, Tel, Pau and
    # Obi are exactly what a line-up page prints, and the length floor above is
    # only there to keep particles like "van" and "de" out of the index.
    if web:
        keys.add(web)
    # nobody agrees where the spaces go in a name carrying a particle. The feed
    # holds Jay Dasilva; Scout prints Jay da Silva. Same for Van den Berg,
    # De Bruyne, Mac Allister. Indexing a spaceless form settles the whole
    # family at once, and an ambiguous squash is struck out like any other.
    for k in list(keys):
        squashed = k.replace(' ', '')
        if len(squashed) >= 5:
            keys.add(squashed)
    return keys


def build_index(players):
    """club code -> key -> player id, with every ambiguous key struck out.

    A key two clubmates would both answer to is not a near miss, it is a
    coin toss, so it is removed entirely and the more specific keys carry
    the match instead.
    """
    per_club = defaultdict(lambda: defaultdict(set))
    for p in players:
        club = norm(p.get('club'))
        if not club:
            continue
        for k in keys_for(p):
            per_club[club][k].add(p['id'])
    # the feed's own disambiguation: when clubmates share a name it abbreviates
    # the others and leaves the man who owns it plain — Arsenal field Gabriel,
    # Martinelli and G.Jesus, and all three answer to "gabriel". Striking that
    # key out would be safe but would lose a nailed-on defender every week, and
    # the feed has already told us which one is meant.
    by_web = defaultdict(lambda: defaultdict(set))
    for p in players:
        by_web[norm(p.get('club'))][norm(p.get('name'))].add(p['id'])
    index, dropped, rescued = {}, 0, 0
    for club, keys in per_club.items():
        clean = {}
        for k, ids in keys.items():
            if len(ids) == 1:
                clean[k] = next(iter(ids))
                continue
            owner = by_web[club].get(k) or set()
            owner &= ids
            if len(owner) == 1:
                clean[k] = next(iter(owner))
                rescued += 1
            else:
                dropped += 1
        index[club] = clean
    index['_dropped'] = dropped
    index['_rescued'] = rescued
    return index


def match(name, club, index):
    """Their printed name plus their club code -> our player id, or None.

    Longest key first: "bruno fernandes" should beat the bare "fernandes"
    when both are on offer, so a page that prints the full name never lands
    on a namesake.
    """
    club_keys = index.get(norm(club))
    if not club_keys:
        return None
    n = norm(name)
    if not n:
        return None
    if n in club_keys:
        return club_keys[n]
    # their spacing need not be ours — "jay da silva" reaching "jaydasilva"
    squashed = n.replace(' ', '')
    if squashed in club_keys:
        return club_keys[squashed]
    # their string may carry more than our key does ("Bruno Fernandes (c)"),
    # so fall back to the longest key their string contains as whole words
    best, best_len = None, 0
    for k, pid in club_keys.items():
        if len(k) > best_len and re.search(rf'(?<![a-z0-9]){re.escape(k)}(?![a-z0-9])', n):
            best, best_len = pid, len(k)
    return best


def load_players():
    return json.loads((ROOT / 'data' / 'data.json').read_text(encoding='utf-8'))['players']


def _report():
    """How well does today's feed key up? Prints; changes nothing."""
    players = load_players()
    index = build_index(players)
    dropped = index.pop('_dropped'); rescued = index.pop('_rescued')
    print(f'{len(players)} players across {len(index)} club codes')
    print(f'ambiguous keys struck out: {dropped}, resolved by the feed\'s own short name: {rescued}')
    unreachable = []
    for p in players:
        club = norm(p.get('club'))
        if not club:
            continue
        # can we find him from the name a page would most likely print?
        if match(p.get('full') or p.get('name'), club, index) != p['id']:
            unreachable.append(f"{p.get('club')} {p.get('name')} ({p.get('full')})")
    print(f'players their full name would NOT reach: {len(unreachable)}')
    for u in unreachable[:20]:
        print('   ', u)


if __name__ == '__main__':
    _report()
