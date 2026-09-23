/* Ben, 23 Sept 2026: Friday's international-break edition stands on its own,
 * leads until club football returns, and then stays in the Gazette archive.
 * Editorial readiness is separate from the clock: Ian's answers must exist. */
const GazetteBreak = (() => {
  const content = () => typeof GAZETTE_BREAK_CONTENT === 'undefined' ? null : GAZETTE_BREAK_CONTENT;
  const textPresent = value => typeof value === 'string' && value.trim().length > 0;
  const publicationReady = () => {
    const c = content();
    if (!c || c.ready !== true || !Number.isFinite(Date.parse(c.publishAt))) return false;
    const interview = c.articles?.find(a => a.id === 'ian');
    const qa = interview?.sections?.flatMap(s => s.qa || []) || [];
    return qa.length >= (Number.isInteger(c.expectedAnswers) && c.expectedAnswers > 0 ? c.expectedAnswers : 1) && qa.every(pair => Array.isArray(pair) && textPresent(pair[0]) && textPresent(pair[1]));
  };
  const published = (now = Date.now()) => publicationReady() && now >= Date.parse(content().publishAt);
  const live = (now = Date.now()) => {
    if (!published(now)) return false;
    const printed = Date.parse(content().publishAt);
    const starts = (typeof GAMEWEEKS === 'undefined' ? [] : GAMEWEEKS)
      .map(gw => Date.parse(gw.from)).filter(time => Number.isFinite(time) && time > printed);
    // Missing calendar data cannot establish that the break is still on.
    return starts.length > 0 && now < Math.min(...starts);
  };
  const paragraphs = lines => (lines || []).map(line => `<p>${esc(line)}</p>`).join('');
  // Explicit local preview is allowed before publication. Public callers use
  // live()/archive(), so incomplete interviews never appear in normal pages.
  const render = () => {
    const c = content();
    if (!c) return '';
    return `<div class="prog-art prog-break"><nav class="prog-break-nav" aria-label="In this edition">${(c.articles || []).map(a => `<a href="#gazette-break-${esc(a.id || '')}">${esc(a.nav || a.head || '')}</a>`).join('')}</nav>${(c.articles || []).map((article, index) => `<article class="prog-story${index === 0 ? ' prog-lead-story' : ''}" id="gazette-break-${esc(article.id || '')}" data-break-article="${esc(article.id || '')}">
      ${article.kicker ? `<div class="prog-story-kicker">${esc(article.kicker)}</div>` : ''}
      <h2 class="prog-head">${esc(article.head || (index === 0 ? c.headline : ''))}</h2>
      ${article.by ? `<div class="prog-by">${esc(article.by)}</div>` : ''}
      ${index === 0 && c.standfirst ? `<p class="prog-deck">${esc(c.standfirst)}</p>` : ''}
      ${paragraphs(article.intro)}
      ${(article.sections || []).map(section => `<section>
        ${section.head ? `<h3 class="prog-sec">${esc(section.head)}</h3>` : ''}
        ${paragraphs(section.paras)}
        ${(section.answers || []).map(answer => `<div class="prog-int-q">${esc(answer.by || '')}</div><p class="prog-int-a">${esc(answer.text || '')}</p>`).join('')}
        ${(section.qa || []).map(([question, answer]) => `<div class="prog-int-q">${esc(question)}</div><p class="prog-int-a">${esc(answer)}</p>`).join('')}
      </section>`).join('')}
      ${paragraphs(article.closing)}
    </article>`).join('')}${c.closingRemark ? `<div class="prog-sec">The Committee’s closing remark</div><p>${esc(c.closingRemark)}</p>` : ''}</div>`;
  };
  const edition = () => ({ key: content().id, edition: content().edition, gwN: null, article: render() });
  const archive = (now = Date.now()) => published(now) ? {
    key: content().id, kind: 'break', edition: content().edition, gwN: null, gw: null,
    printed: Date.parse(content().publishAt), article: render
  } : null;
  return { publicationReady, published, live, render, edition, archive };
})();
