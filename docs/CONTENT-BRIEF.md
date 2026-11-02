# FATHOM answer-bank brief (for content agents)

You are writing part of the answer bank for FATHOM, a daily ocean-trivia game. Each prompt is open-ended ("Name a shark species") and every accepted answer sits in a rarity tier. Rarer accepted answers score more. Your job: for each prompt assigned to you, produce at least 25 accepted answers, each tied to an entity with aliases and one true fact, and assign tiers.

## Output

One JSON file per agent at `data/batches/batch<LETTER>.json` (you may split into `batch<LETTER>-1.json`, `-2.json` … if that is easier — each file must be self-contained: every entity an answer references must be defined in the same file):

```json
{
  "entities": [
    {
      "id": "great-white-shark",
      "name": "Great white shark",
      "aliases": ["white shark", "great white", "white pointer", "Carcharodon carcharias"],
      "kind": "creature",
      "group": "sharks",
      "fact": "Great whites can sense the tiny electrical fields given off by a hidden animal's heartbeat."
    }
  ],
  "prompts": [
    { "id": "shark-species", "answers": [ { "entity": "great-white-shark", "tier": "tidepool" }, ... ] }
  ]
}
```

Prompt ids and texts come from `data/prompt-seeds.json` — use the ids exactly. Do not invent prompts.

## Entity rules

- `id`: a slug of the canonical common name, lowercase ASCII, hyphens: `great-white-shark`, `mariana-trench`, `jacques-cousteau`. Other agents will use the same rule, so identical creatures merge automatically — pick the most standard English name (prefer `orca` with alias "killer whale"; `ocean-sunfish` with alias "mola mola").
- `name`: the canonical common name as a person would type it. Capitalise only the first word and proper nouns.
- `aliases`: alternate common names, the scientific name, regional names, well-known nicknames. 0–14 entries. Do NOT add plural forms (the game pluralises automatically) and do not add misspellings (the game fuzzy-matches).
- `kind`: one of `creature`, `plant`, `place`, `vessel`, `person`. Seaweeds, seagrasses and mangroves are `plant`. Seas, trenches, reefs, islands, ports, dive sites and seafloor features are `place`. Ships, submersibles, wrecks and boat types are `vessel`.
- `group`: a short lowercase label for the natural grouping (sharks, rays, whales, dolphins, seals, turtles, reptiles, cephalopods, crustaceans, jellies, fish, corals, echinoderms, molluscs, plankton, seabirds, plants, seas, trenches, islands, ports, reefs, vessels, wrecks, boats, people, features, mammals, microbes …). Be consistent inside your batch.
- `fact`: ONE sentence, 20–240 characters, ends with a full stop. True and well established. No invented numbers; prefer "about", "up to", "roughly". Where natural, the fact should show why the entity fits the prompt. British spelling (metres, colour). No "some say", no superlatives unless they are famous and certain.
- Define each entity once per file and reference it from as many prompts as it fits.

## Answer rules

- Every answer must genuinely satisfy the prompt. If you are not sure, leave it out. Only well-documented species, places and people.
- At least 25 answers per prompt; 28–35 is better. Exactly ONE `hadal` answer per prompt.
- No two entities in the same prompt may share any name or alias (the validator checks this). Example: do not list a generic `hammerhead-shark` (alias "hammerhead") and `great-hammerhead` (alias "hammerhead") in the same prompt — give the alias to only one of them.
- Group names count as answers: on "Name a shark species", a player who types "hammerhead", "tuna" or "mako" must not be rejected. Add a generic entity (e.g. `hammerhead-shark`, name "Hammerhead shark", aliases ["hammerhead"]) at `tidepool` or `baitball`, and keep specific species (`scalloped-hammerhead`, `great-hammerhead`) as separate higher-tier entities without the bare group alias.

## Tiers (points) — judge by how likely an average adult is to say it

- `tidepool` (10): the first answers almost anyone would give. 3–5 per prompt.
- `baitball` (15): the "clever" answer a trivia fan reaches for — the famous obscure pick that is not actually rare (goblin shark on a weird-shark prompt, blobfish for the deep sea, Mariana Trench for trenches). 2–3 per prompt.
- `reef` (30): solid answers a reasonably informed person knows. 6–9 per prompt.
- `twilight` (60): uncommon — a diver, angler or keen documentary watcher would know. 6–9 per prompt.
- `midnight` (85): specialist knowledge — specific species, scientific-level names. 4–7 per prompt.
- `hadal` (100): exactly one — the single most satisfying, surprising, defensible valid answer. Pick it for fun factor as much as rarity.

## Validate before you finish

Run: `node tools/validate-batch.js data/batches/batch<LETTER>.json --expect <comma-separated prompt ids you were assigned>`

It must print `OK`. Fix every `ERROR:` line; read the `warn:` lines and fix the ones you can. Run it after writing each file. Do not finish until it passes for every file you wrote.

## Report back

When done, reply with: the file names, the validator's final OK line(s), the number of entities, any prompt where you found fewer than 28 answers, and any fact you were less than certain about (list them so the reviewer can check).
