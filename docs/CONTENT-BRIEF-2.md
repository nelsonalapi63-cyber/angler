# FATHOM answer-bank brief, round 2 (for content agents)

Read docs/CONTENT-BRIEF.md first — every rule there still applies (entity shape, ids as slugs, aliases without plurals, kinds, one true fact sentence in British spelling, tier meanings, the group-name rule, no two entities with the same canonical name inside one prompt). This round changes four things:

1. **The floor is 40 accepted answers per prompt** (50–60 is better). Spread them: Tide Pool 4–6, Bait Ball 3–4, Reef 9–12, Twilight 10–14, Midnight 10–20 (the long tail — specific species an expert might type), exactly one Hadal. If a prompt genuinely cannot reach 40 true answers, stop at the true maximum and say so in your report; never pad with wrong answers.

2. **A new kind `other`** for things that are not creatures, plants, places, vessels or people: dishes, cooking methods, jobs, instruments, units, sailor words, phenomena, organisations, treaties, sports, books, films, myths, battles, expeditions. Give them a sensible `group` (dishes, methods, jobs, instruments, words, phenomena, organisations, sports, works, myths, battles, voyages).

3. **Scientific names**: every creature or plant entity you define gets its Latin binomial as an alias when the species has one (genus-level name for group entities, e.g. "Sphyrna" on hammerhead-shark). Families and orders are fine for generic entities.

4. **Existing entities may be reused** (top-up batches only): read data/entities.json and reference an existing id in your answers without redefining it. Validate those batches with the `--known` flag: `node tools/validate-batch.js data/batches/<file> --known --expect <ids>`. New entities must still be defined in your file. For a new-prompt batch, define everything you reference (reusing an existing id with an identical definition is fine; the merge keeps the stored one).

Letter prompts ("Name a fish whose name begins with the letter S"): the canonical name must start with that letter (ignore "the"). Aliases may not — a player typing an alias that starts with another letter still gets the answer; that is fine.

Prompts with a taxon safety net (shark-species, fish letters, etc.) will also accept any species on a reference list at Midnight, so concentrate your hand-written Midnight tier on answers with a good fact rather than trying to list every species.

Write your batch to the file named in your task. Validate until it prints OK. Report back with: file name, the validator's final OK line, entity count, any prompt that could not reach 40 (with the true count), and any fact you were less than certain about.
