'use strict';
/* v4: data/frozen.json keeps, per played day, the exact answer lists each of its questions had — so the archive
 * (and anyone replaying a day) sees what people played, however the bank grows afterwards. build.js snapshots
 * every scheduled day up to today once; the browser applies the snapshot when it starts a dive for a frozen day. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FathomFrozen = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Returns a new frozen map: existing days untouched, every scheduled day <= uptoKey added from the current prompts.
  function snapshotFrozen(schedule, prompts, existing, uptoKey) {
    const byId = {};
    for (const p of prompts) byId[p.id] = p;
    const out = {};
    for (const k of Object.keys(existing || {})) out[k] = existing[k];
    for (const k of Object.keys(schedule || {}).sort()) {
      if (k > uptoKey || out[k]) continue;
      const day = {};
      for (const id of schedule[k]) if (byId[id] && byId[id].answers) day[id] = byId[id].answers.map(a => ({ entity: a.entity, tier: a.tier }));
      out[k] = day;
    }
    return out;
  }
  function frozenPrompt(frozen, dayKey, prompt) {
    const day = frozen && dayKey && frozen[dayKey];
    if (!day || !prompt || !day[prompt.id]) return prompt;
    return Object.assign({}, prompt, { answers: day[prompt.id].map(a => ({ entity: a.entity, tier: a.tier })), _index: null, _frozen: true });
  }
  return { snapshotFrozen, frozenPrompt };
});
