/* Ben, 4 Sept: the existing cast gets an inbox and a memory. Shared with
 * Functions: facts and options are rebuilt on the server, never trusted from
 * a browser. Public league records only; no private lists, no random clock. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ClubMedia = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const arr = x => Array.isArray(x) ? x : Object.values(x || {});
  const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const pick = (xs, key) => xs[hash(key) % xs.length];
  // Same order as the selectable assistants in lore.js; a test pins it.
  const STAFF = ['Lawrie McMenemy', 'Phil Neal', 'Peter Taylor', 'Tord Grip', 'Pat Rice', 'Terry McDermott', 'Rui Faria', 'Željko Buvač', 'Mike Phelan', 'Carlos Queiroz', 'Ray Lewington', 'Steve McClaren'];
  const VOICES = {
    'Lawrie McMenemy': ['Standards, boss. Shirts tucked in. Even the statement.', 'I have assembled the staff. Nobody is leaving until this is a football club again.', 'Put my name on it if you must. Spell it correctly.'],
    'Phil Neal': ['Yes, boss. Exactly what I was thinking, boss.', 'You are absolutely right. About whichever bit you meant.', 'My fault, boss. I was just about to say that.'],
    'Peter Taylor': ['I can find you a player. I cannot find you a better excuse.', 'Let them talk. I have seen a lad who might actually help.', 'You do the interviews. I will do the bit that wins matches.'],
    'Tord Grip': ['We could say nothing. In Sweden this is permitted.', 'I have brought the accordion. It is not the worst idea in the room.', 'I will speak to him quietly. This appears not to have been tried.'],
    'Pat Rice': ['Training, then. Same time.', 'I have put the cones out. The cones have made no comment.', 'Right. I will get on with it.'],
    'Rui Faria': ['I have written down the names. Every single name.', 'They are all against us. I have added this to the folder.', 'I was sent off for less. Much less.'],
    'Terry McDermott': ['Kev would have loved this. Not solved it. Loved it.', 'Get the lads together. Cup of tea. Tell them we are going to win.', 'I will have a word. I know a fella who knows him.'],
    'Željko Buvač': ['…', 'He has left a diagram. There are no labels.', 'His chair is empty. A cone has moved.'],
    'Mike Phelan': ['I was in the middle of something agricultural. Is this urgent?', 'I will take training. You take whatever this is.', 'Shorts on. Cones out. The rest is above my pay grade.'],
    'Carlos Queiroz': ['At Real Madrid we had a department for this. Several, actually.', 'I have prepared a report. You have prepared a headline.', 'I left a bigger job than this and came back. Think about that.'],
    'Ray Lewington': ['Roy would want the distances right. Between us and the press, ideally.', 'Two banks of four. That is my answer to the question.', 'Keep the shape. We can have the argument after training.'],
    'Steve McClaren': ['We must show, how you say, character. I have always said character.', 'I have prepared a statement and checked the forecast.', 'There is no such thing as bad weather. There is bad preparation. And that photograph.'],
  };
  function staff(state, mid) {
    const a = arr(state.managers).find(m => m.id === mid)?.assistant;
    return typeof a === 'number' && STAFF[a] ? STAFF[a] : a && typeof a.t === 'string' ? a.t : STAFF[(mid * 5 + 2) % STAFF.length];
  }
  function voice(name, key, blamed = false) {
    const bank = VOICES[name];
    if (!bank) return blamed ? 'I will discuss this with the manager. In private, initially.' : 'I will take training. You handle the microphones.';
    return blamed ? bank[2] : pick(bank.slice(0, 2), key);
  }
  const manager = (s, mid) => arr(s.managers).find(m => m.id === mid) || {};
  const club = (s, mid) => manager(s, mid).team || manager(s, mid).name || 'The club';
  function results(state, mid, gw, api) {
    const out = [];
    for (let g = 0; g < gw; g++) {
      if (api.gwStatus(state, g) !== 'final') continue;
      const pr = api.pairingsFor(state, g).find(p => p.includes(mid));
      if (!pr) continue;
      const opp = pr.find(id => id !== mid);
      out.push({ gw: g, opp, scored: api.gwManagerPoints(state, mid, g), conceded: api.gwManagerPoints(state, opp, g) });
    }
    return out;
  }
  function history(state, mid, gw) {
    return Object.values(state.mediaCases?.[mid] || {}).filter(r => r && Number.isInteger(r.gw) && r.gw < gw).sort((a, b) => b.gw - a.gw);
  }
  function receipt(state, mid, gw) {
    const candidates = [];
    for (const [key, rec] of Object.entries(state.pressers?.[mid] || {})) {
      const [g, phase] = key.split(':');
      if (!(+g < gw && +g >= Math.max(0, gw - 4))) continue;
      const answers = arr(rec?.answers);
      const storm = answers.some(a => a?.storm);
      const a = answers.find(a => a && !a.storm && !a.own && ['confident', 'unhinged'].includes(a.tone) && a.text && a.text !== 'No comment.');
      // Free text is printed verbatim, never interpreted as a boast or admission.
      const own = answers.find(a => a?.own && a.text);
      if (storm || a || own) candidates.push({ gw: +g, phase, storm, text: storm ? '' : (a || own).text, evidence: `presser:${key}` });
    }
    return candidates.sort((a, b) => b.gw - a.gw || a.phase.localeCompare(b.phase))[0] || null;
  }
  const OPTIONS = {
    back: { label: 'Back the players', line: 'I have complete faith in this group. We go again.' },
    blame: { label: 'Blame the assistant', line: 'Preparation is the responsibility of my assistant. You would have to ask him.' },
    ban: { label: 'Ban the reporter', line: 'David Ornsteak will not be admitted to our next press conference.' },
    apologise: { label: 'Clear the air', line: 'We have had an honest conversation. Everyone is welcome. We move on.' },
    double: { label: 'Double down', line: 'I stand by every word. If anything, I was being generous.' },
    quiet: { label: 'Keep it in-house', line: 'We will deal with this internally. That is all I am prepared to say.' },
  };
  function incident(state, mid, gw, api) {
    if (state.phase !== 'season' || !Number.isInteger(gw) || gw < 0 || gw >= api.REGULAR_GWS || !arr(state.managers).some(m => m.id === mid)) return null;
    const old = history(state, mid, gw), previous = old[0];
    const rs = results(state, mid, gw, api);
    let defeats = 0;
    for (const r of [...rs].reverse()) { if (r.scored < r.conceded) defeats++; else break; }
    const said = receipt(state, mid, gw);
    let kind, title, body, choices, evidence;
    if (previous?.grudge === 'ban' && gw - previous.gw <= 4) {
      kind = 'carpark'; title = 'He is still in the car park'; evidence = `case:${previous.gw}`;
      body = `David Ornsteak remains banned following your GW${previous.gw + 1} statement. His request for accreditation has arrived on a windscreen. He would like to know whether the ban extends to the pavement.`;
      choices = ['apologise', 'double', 'quiet'];
    } else if (previous?.grudge === 'assistant' && gw - previous.gw <= 3) {
      kind = 'assistant'; title = 'Your assistant would like a word'; evidence = `case:${previous.gw}`;
      body = `In GW${previous.gw + 1} you left ${previous.speaker} carrying the can. A meeting has been requested. The agenda contains one item: your interview.`;
      choices = ['apologise', 'double', 'back'];
    } else if (defeats >= 3) {
      kind = 'board'; title = 'The dreaded vote of confidence'; evidence = `defeats:${rs.at(-1).gw}:${defeats}`;
      body = `${defeats} consecutive defeats. The board has offered its full backing and asked you to attend a meeting without your coat. Your assistant has already put the cones out.`;
      choices = ['back', 'blame', 'ban'];
    } else if (said && !old.some(r => r.evidence === said.evidence)) {
      kind = 'receipt'; title = said.storm ? 'The door has followed you here' : 'About what you said'; evidence = said.evidence;
      body = said.storm ? `You walked out of the GW${said.gw + 1} press conference. David Ornsteak has brought that up again. He has also brought a doorstop.` : `In GW${said.gw + 1} you said: “${said.text}” David Ornsteak has kept the cutting. He is asking whether that remains the club’s position.`;
      choices = ['apologise', 'double', 'ban'];
    } else {
      const moves = arr(state.transfers).filter(t => t.managerId === mid && t.gw === gw);
      if (moves.length >= 3) {
        kind = 'market'; title = 'The revolving door'; evidence = `moves:${gw}:${moves.length}`;
        body = `${moves.length} arrivals are recorded for GW${gw + 1}. Your assistant has asked for a squad photograph with removable faces. The press would like to know whether this is a rebuild.`;
        choices = ['back', 'blame', 'quiet'];
      } else return null; // No incident is better than a weekly chore.
    }
    return { gw, kind, title, body, evidence, choices, speaker: staff(state, mid), key: `${gw}:${kind}:${hash(body)}` };
  }
  function decide(state, mid, item, choice, t) {
    if (!item || !item.choices.includes(choice) || !OPTIONS[choice]) return null;
    const old = history(state, mid, item.gw)[0];
    let grudge = choice === 'ban' ? 'ban' : choice === 'blame' ? 'assistant' : '';
    if (['double', 'quiet'].includes(choice) && ['carpark', 'assistant'].includes(item.kind)) grudge = old?.grudge || '';
    const line = OPTIONS[choice].line;
    const reply = choice === 'blame' ? voice(item.speaker, `${mid}:${item.gw}`, true)
      : choice === 'ban' || grudge === 'ban' ? 'Understand the ban remains in place. Can confirm the car park has excellent reception. More to follow.'
      : choice === 'apologise' ? 'The air has been cleared. The screenshots have been retained.'
      : voice(item.speaker, `${mid}:${item.gw}:${choice}`);
    const reporter = choice === 'ban' || grudge === 'ban' || choice === 'apologise';
    const report = choice === 'blame' ? `${club(state, mid)} have placed responsibility with ${item.speaker}. Sources close to the assistant describe the sources close to the manager as the manager.`
      : grudge === 'ban' ? `${club(state, mid)}: Ornsteak remains outside. The club are controlling access. They are having less success controlling the story.`
      : choice === 'apologise' ? `${club(state, mid)} call for everyone to move on. The previous statement remains available.`
      : choice === 'double' ? `${club(state, mid)} stand by the statement. The press have made room for a second cutting.`
      : choice === 'quiet' ? `${club(state, mid)} will deal with matters internally, according to a statement issued externally.`
      : `${club(state, mid)} back the players. ${item.speaker} has been informed that this includes training tomorrow.`;
    return { ...item, choice, line, reply, replyBy: reporter ? 'David Ornsteak' : item.speaker, report, grudge, t };
  }
  function echoes(state, gw, api) {
    const out = [];
    for (const m of arr(state.managers)) {
      const last = history(state, m.id, gw)[0];
      const rs = results(state, m.id, gw, api);
      if (last && last.grudge && gw - last.gw <= 4) {
        const since = rs.filter(r => r.gw >= last.gw);
        if (!since.length) continue;
        const wins = since.filter(r => r.scored > r.conceded).length;
        const losses = since.filter(r => r.scored < r.conceded).length;
        const subject = last.grudge === 'ban' ? 'The ban on David Ornsteak' : `The dispute with ${last.speaker}`;
        out.push({ mid: m.id, sourceGw: last.gw, text: `${subject} at ${club(state, m.id)} dates back to GW${last.gw + 1}. Since then: ${wins} won, ${since.length - wins - losses} drawn, ${losses} lost. ${last.grudge === 'ban' ? 'The reporter is still outside. The results are still public.' : 'Neither party has requested the minutes.'}` });
        continue;
      }
      const said = receipt(state, m.id, gw);
      if (!said) continue;
      const since = rs.filter(r => r.gw >= said.gw + (said.phase === 'post' ? 1 : 0));
      if (!since.length) continue;
      const wins = since.filter(r => r.scored > r.conceded).length;
      const before = said.storm ? `walked out of the GW${said.gw + 1} press conference` : `said in GW${said.gw + 1}: “${said.text}”`;
      out.push({ mid: m.id, sourceGw: said.gw, text: `${manager(state, m.id).name || club(state, m.id)} ${before}. ${wins} win${wins === 1 ? '' : 's'} from ${since.length} settled match${since.length === 1 ? '' : 'es'} since. ${wins === since.length ? 'The cutting is becoming difficult to argue with.' : 'The cutting has been recirculated.'}` });
    }
    return out;
  }
  return { STAFF, OPTIONS, VOICES, voice, staff, results, incident, decide, echoes, hash };
});
