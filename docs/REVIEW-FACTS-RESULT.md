# Fact-check result — FATHOM answer bank

Independent review of `docs/REVIEW-FACTS.md` plus a seeded random spot-check. Nothing in `data/entities.json` or `data/prompts.json` was edited; every change is in `data/patches/review.json` (apply with `node tools/apply-patch.js data/patches/review.json`). The patch was dry-run on a copy of the repo: it applies cleanly and `validate-data.js` reports OK (2,366 entities, 124 prompts, 4,585 answers after 5 removals; one new warning, see "Orphan" below).

Summary

- Flagged claims checked: 126 entities across batches A–F, plus every entity–prompt pair under "Prompt-fit calls" (about 45 pairs).
- Spot-check: 90 further entities drawn with a fixed seed (mulberry32, seed 20261102), one from each of the 50 groups then filled at random; each fact and each prompt placement checked. On top of that, all 395 facts containing a superlative ("largest", "only", "first", "deepest", "most ...") were read through and the doubtful ones searched.
- Facts corrected: 40 (32 from the flagged list, 8 found in the spot-check / superlative sweep).
- Entities removed from a prompt: 5 pairs (no entity deleted outright, no prompt left under 25 answers, every prompt keeps its hadal).
- Retiers suggested: 7 (three prompts). Alias changes: 1 added, 1 removed.
- Verified and kept unchanged: everything else on the flagged list (94 claims) and 82 of the 90 sampled entities.

Three worst errors found

1. `yellowtail-amberjack` (Seriola lalandi) carried the alias "hamachi" and the fact said it is "served as hamachi". Hamachi is the Japanese amberjack, Seriola quinqueradiata (already a separate entity, `yellowtail`); S. lalandi is sold as hiramasa. Players typing "hamachi" would have been shown the wrong species. Fixed fact, alias swapped. Source: Wikipedia, Yellowtail amberjack ("known as hiramasa").
2. `dragon-hole` — "the deepest known blue hole". Superseded: the Taam Ja' Blue Hole in Chetumal Bay, Mexico, was echo-sounded to at least 420 m (published 2024) against the Dragon Hole's 300.89 m. Source: Wikipedia, Taam Ja' Blue Hole.
3. `smooth-handfish` (the hadal answer on "extinct") — "declared extinct in 2020, the first modern marine bony fish to be lost". The IUCN withdrew that assessment in September 2021 and reset the species to Data Deficient. Still a fair answer to "name a sea creature that is extinct" (one specimen, 1802), but the fact needed the caveat. Source: Wikipedia, Smooth handfish.

Runners-up: `blue-starfish` claimed Linckia laevigata regrows a whole star from one severed arm (only documented for L. multifora; "not yet documented" for laevigata); `pollock` claimed spawning grunts (only handling "thumps" are recorded, Fish & Mowbray 1970 via FishBase); two protists (`xenophyophore`, `foraminifera`) sat on the "name an animal" hadal prompt.

---

## Batch A (sharks, rays, whales, dolphins, seals, reptiles, shelled)

Verified, kept as written

- brownbanded-bamboo-shark — Wikipedia: "can survive out of the water for up to 12 hrs".
- ninja-lanternshark — name chosen by describer Vicky Vásquez's young cousins; Etmopterus benchleyi honours Peter Benchley (well documented, 2015 description).
- pocket-shark — two specimens ever (M. parini 1979, M. mississippiensis 2010); pocket glands thought to secrete luminous fluid (Grace et al. 2019).
- broadnose-sevengill-shark — Save Our Seas species page: "observed hunting cooperatively to catch large prey, like seals"; Ebert 1991 describes this off South Africa.
- grays-beaked-whale — Te Ara (NZ encyclopedia): "the most common New Zealand whale to become stranded"; Wikipedia records Antarctic-area sightings. Stays on polar-cetacean.
- trues-beaked-whale — first underwater footage published 2017 (Aguilar de Soto et al., PeerJ), filmed in the Azores.
- bolivian-river-dolphin — 2012 law (Evo Morales) declared it national natural heritage; separated from Amazon dolphins by rapids (Wikipedia).
- galapagos-sea-lion — benches and the Puerto Ayora fish market are documented in countless news photos ("sea lions cuddle on beach chairs", KIRO/Action News); kept.
- belchers-sea-snake — Wikipedia: "erroneously popularized as the most venomous snake in the world" (Bryan Grieg Fry), timid temperament.
- annulated-sea-snake — Palci et al. 2019: modified cephalic vascular network supplies oxygen from water (Wikipedia, Hydrophis cyanocinctus).
- stokes-sea-snake — Wikipedia: "one of the heaviest and stoutest seasnakes, with the longest fangs of any marine snake".
- little-skate — "punting" on crura (modified pelvic fins); NW Atlantic, Nova Scotia to Cape Hatteras (Wikipedia).
- atlantic-torpedo — 1.8 m, 90 kg, up to 220 volts, largest electric ray (Wikipedia).

Corrected (fact in patch)

- tasselled-wobbegong — The 2011 Great Keppel Island photo (Ceccarelli & Williamson, Coral Reefs 2012; LiveScience) shows the bamboo shark head-first in the mouth; the researchers "assume" it was eventually consumed. Reworded to what was photographed.
- spotted-wobbegong — Australian Museum gives "about 3 m" but Wikipedia/FishBase give 150–180 cm usual, 320 cm reported; ISAF lists four unprovoked bites. Reworded to "usually under 2 metres, reported up to about 3" and "has bitten people who stepped on or disturbed it".
- heavisides-dolphin — Not a misspelling: Gray misidentified Captain Haviside (East India Company) as the surgeon John Heaviside, so the name honours the wrong man (Wikipedia). Reworded.
- clymene-dolphin — Wikipedia: "the only confirmed case of hybrid speciation in marine mammals". Softened "only marine mammal known" to "only confirmed case".
- dalls-porpoise — Japan's hunt was the largest direct hunt of any cetacean (45,000 in 1988) but the 2023 take was 109 animals; put in the past tense.
- dubois-sea-snake — Wikipedia: "will bite if provoked", preys on moray eels and seafloor fish up to 110 cm, not "small reef fish". Reworded.
- thick-billed-murre — Wikipedia gives dives to 150 m; the "over 200 m / deeper than any other flying bird" claim is not supported there. Reworded to "among the deepest-diving flying birds, dives recorded to 150 metres and beyond".

## Batch B (cephalopods, crustaceans, jellies, flatfish, deep sea, vents, light)

Verified, kept

- ghost-crab — Guinness World Records (fastest crustacean on land): up to 4 m/s, so "more than 2 metres per second" holds.
- petrale-sole — NBC/AP: "one of the most valuable Pacific Ocean groundfish"; right-eyed (Wikipedia).
- dover-sole, lemon-sole, winter-flounder — the flagged etymology and tomato claims are already gone; remaining facts check out (Microstomus kitt is a right-eyed pleuronectid; winter flounder carry type I antifreeze proteins).
- flapjack-octopus — Wikipedia: "Pearl, is a flapjack octopus"; body flattens on the seafloor.
- vent-anemone — Marianactis bythios (Fautin & Hessler 1989) is a real vent anemone; alias fine.
- vent-squat-lobster — Munidopsis have reduced eyes and are pale; fine.
- alvinocaris-shrimp — Alvinocaris lusca Williams & Chace 1982, Galápagos Rift (GBIF); among the earliest vent animals described.
- akiami-paste-shrimp — Wikipedia: "the species of wild shrimp or prawn with the highest reported annual catch" (402,000 t in 2019).
- langoustine — Wikipedia: among the most economically important fisheries in Europe, 58% of the catch taken by the UK; "sold as scampi".
- antarctic-fur-seal — South Georgia population 4.5–6.2 million (Wikipedia); nearly exterminated by 19th-century sealers.
- tasmanian-giant-crab — 17.6 kg, males with one oversized claw, continental-shelf edge 20–820 m (Wikipedia).
- bigfin-squid — total length estimated 8 m or more; juvenile filmed at 6,212 m in the Philippine Trench, March 2021 (Wikipedia).
- kuruma-prawn — Motosaku Fujinaga spawned Penaeus japonicus in captivity in 1934 (Global Seafood Alliance history of shrimp farming).
- flower-urchin — Guinness 2014 "most dangerous sea urchin"; fatalities reported but unverified, which the hedged wording already reflects.

Corrected

- coconut-crab — Oka et al. 2016 (LiveScience): grip up to 1,765 N measured, ~3,300 N estimated for the largest, "exceeds the bite force of all animals other than alligators" on a body-mass basis. Reworded with the number and "stronger than most animals' bites".
- california-halibut — Wikipedia: "roughly equal left and right sided eye development", not 40%. Reworded to "nearly half".
- humpback-anglerfish — Wikipedia makes no Finding Nemo claim; the film's angler is never identified to species. Replaced with the verified size dimorphism (females to 153 mm, males 15–28 mm).
- veined-squid — Wikipedia: "one of the most common squid species fished in the United Kingdom", not "the main". Reworded.
- vent-barnacle — Wikipedia (Vulcanolepas osheai): cirri carry filamentous bacterial epibionts; feeding on them is only "suggested" by isotopes. Reworded to "thought to be part of their diet".
- ethereal-snailfish — Still known only from video (UW News 2017; no collection reported since). Reworded to say so explicitly rather than asserting a negative.

## Batch C (diadromous, tide pool, reefs, seas, straits, currents, islands, vessels, explorers)

Verified, kept

- great-sea-reef — Wikipedia: "the third longest continuous barrier reef in the world"; Cakaulevu.
- philippine-sea — "the largest sea in the world", 5 million km²; contains the Mariana Trench (Wikipedia).
- bay-of-all-saints — largest bay in Brazil (1,223 km²); Vespucci entered it on 1 November 1501 (Wikipedia).
- new-britain-trench — Planet Deep 9,140 m; landers deployed there (Gallo et al. 2015 lander study cited on Wikipedia).
- james-clark-ross — NOAA photo library: Erebus/Terror sounding of about 2,200 fathoms (c. 4,000 m) in 1840, "first modern successful sounding in deep ocean"; other sources give 2,425 fathoms. Ross Sea discovered January 1841.
- turneffe-atoll — manatees, crocodiles, mangrove and seagrass all on Wikipedia; bonefish flats are well known.
- canary-islands — Pliny's Canaria from canis; standard.
- shetland — Lerwick–Bergen c. 360 km versus Lerwick–Edinburgh c. 480 km (great-circle); claim holds.
- marbled-lungfish — 133 billion base pairs (Wikipedia) versus 3.1 billion for humans: about 43 times.
- mexican-golden-trout — Sierra Madre Occidental headwaters; among the southernmost native trout in North America.
- pillar-coral — "can grow to a height of 3 m"; polyps extended by day (Wikipedia).

Corrected

- apo-reef — Wikipedia says it "is considered" the second-largest contiguous reef system; hedged to "often described as".
- blue-starfish — Wikipedia (Linckia laevigata): comet reproduction "not yet documented" for this species, documented for L. multifora. Reworded.
- gulf-of-st-lawrence — Wikipedia does not call it the world's largest estuary (that label belongs loosely to the St Lawrence estuary); "ice covers the entire gulf in January and February". Reworded.
- guanabara-bay — Wikipedia: the river-mouth story is a widespread belief but "rio" was then applied to bays too. Reworded as "by tradition".
- uss-albatross — Wikipedia: "reputedly the first research ship ever built specially for marine research". Hedged.
- molasses-reef — Wikipedia only calls it a popular Keys dive site; the "one of the most visited reefs in the world" line is dive-shop copy. Reworded.
- arapaima — verified maximum 3.07 m; Wikipedia gives no "every few minutes" figure. Reworded to "surface regularly".
- slate-pencil-urchin — No source found for writing on slates; the name is for the pencil-shaped spines, which are sold as wind chimes and jewellery. Reworded.

## Batch D (wrecks, ports, boats, seaweed, food, families, records, reef fish)

Verified, kept

- colossal-squid — about 500 kg, heaviest invertebrate; size estimates up to 10 m keep it on "giant" (>8 m), borderline but standard.
- oarfish — longest bony fish, about 8 m (reports to 11 m); kept on "giant".
- neptune-grass — Ibiza–Formentera clone "estimated at 100,000 years old" (Wikipedia).
- glass-sponge — Monorhaphis chuni specimen c. 11,000 years (Wikipedia).
- zebrafish, neon-goby — 3–4 cm and up to 5 cm; both fit "smaller than 5 centimetres".
- lobster — "some may live for decades" is already hedged; stays on long-lived.
- casablanca — Morocco's main Atlantic-coast port (Tanger Med is on the Strait); kept.
- freetown — founded 11 March 1792; "one of the world's largest natural deep water harbours" (Wikipedia).
- new-zealand-longfin-eel — females 20–60 years, records to 106; breed once and die (Wikipedia).

Corrected

- vigo — Wikipedia: "one of the main ports for the marketing of fresh fish ... in the world"; "Europe's biggest fishing port" is a local boast. Reworded.
- bombay-duck — dried in the open air/sun (Wikipedia); "racks" dropped.
- yellowtail-amberjack — hamachi/hiramasa confusion (see worst errors). Fact fixed; alias "hamachi" removed, "hiramasa" added.

## Batch E (seahorses, puffers, seabirds, migration, electric, pelagic, polar, mangrove, GBR, kelp, plankton, molluscs, parents, Red Sea, Med, names, colour, sound, snouts, jumpers)

Verified, kept

- sculpin, silver-perch — Cottidae sound production and Chesapeake drumming choruses (Bairdiella) are standard in the fish-sound literature.
- snow-petrel — Wikipedia: "one of only three birds that have been seen at the Geographic South Pole"; most southerly breeding sites of any bird.
- south-polar-skua — Wikipedia: "have been seen at the actual Geographic South Pole"; penguin eggs/chicks are well-documented prey at Antarctic colonies.
- red-bass — Queensland DAF tidal-waters rules list red bass as "No take"; Fishes of Australia confirms ciguatera.
- mahi-mahi — "among the fastest-growing"; speed claim up to 92 km/h (Wikipedia). Fits fast-fish.
- dusky-grouper, kelp-perch (Wikipedia: "known to be a cleaner fish"; surfperches are live-bearers), grey-triggerfish (Wikipedia: "continuing to expand northwards", Cornwall, Tiree) — fine.
- dwarf-minke-whale — Australian Geographic: "the only place in the world that you can swim with dwarf minke whales", boats "operate under a special licence".
- sardine — etymology already removed; fine.
- antarctic-petrel — colonies up to 250 km inland (Wikipedia); Svarthamaren c. 200 km.
- macaroni-penguin — most numerous penguin (c. 18 million) and "consumes more marine life annually than any other species of seabird" (Wikipedia).
- electric-ray — headache/gout line already removed; 220 V matches the Atlantic torpedo.

Corrected

- pollock — FishBase (Fish & Mowbray 1970): saithe produce swim-bladder "thumps" under duress; no spawning grunts recorded. Reworded.
- tiger-tail-seahorse — Project Seahorse: H. comes and H. kuda together make up nearly two-thirds of the Philippine trade. Reworded from "the mainstay".
- picasso-triggerfish — Parmentier et al. 2017 (J. Exp. Biol.): sound made by beating the pectoral fins on the swim bladder. Reworded from "grunts when caught".
- coral-trout — AIMS: "one of the most valuable species" on the Great Barrier Reef. Hedged.
- gentoo-penguin — Wikipedia: "fastest underwater swimmers of all penguins" (36 km/h); the "fastest bird" claim is not supported. Reworded to "fastest-swimming penguin".

## Batch F (seafloor, dive sites, endangered, extinct, names, regions, invasive, aquarium, freshwater, angling, living fossils, forage fish, nocturnal, regeneration)

Verified, kept

- galapagos-marine-reserve 133,000 km² (plus 60,000 km² Hermandad, 2022); hawaiian-emperor-seamount-chain 6,200 km; java-trench 7,290 m; dahab-blue-hole c. 100 m with the arch at 56 m; cobb-seamount 500 km off Washington, summit 34 m; bowie-seamount summit 24 m; cabo-pulmo biomass +463% (Aburto-Oropeza et al. 2011) — all consistent with the hedged wording.
- north-atlantic-right-whale c. 370; vaquita 7–10 (2025 survey, Wikipedia); maui-dolphin c. 54 adults; hawaiian-monk-seal c. 1,400–1,600 (Wikipedia/NOAA); galapagos-penguin under 2,000; yangtze-finless-porpoise c. 1,250 (2022); spotted-handfish a few thousand; rices-whale c. 50 — all fine with "about/around".
- lesser-electric-ray 14–37 V (Wikipedia); bumphead-parrotfish 1.3 m; megalodon 15–20 m, 3.6 Mya (Wikipedia); leedsichthys c. 16 m; basilosaurus 17–20 m, "king lizard" from the reptile misidentification, 35 cm hind limbs (Wikipedia); sea-scorpion 2.5 m, end-Permian; neopilina (Galathea 1952, described 1957; monoplacophorans thought extinct since the Devonian); lingula (Darwin, Origin); mantis-shrimp (bullet-like acceleration, 12–16 photoreceptor types); lanternfish "as much as 65% of all deep sea fish biomass" (Wikipedia); sea-toad (Chaunacidae hold an inflated gill chamber up to 245 s); sand-tiger-shark, tiger-shark, caribbean-reef-octopus — the flagged lines were already rewritten and the current facts are standard.
- port-jackson-shark — spiral egg cases wedged into crevices is standard; but see removal from "venomous" below.

Corrected

- kronosaurus — the Colombian "K. boyacensis" was moved to Monquirasaurus in 2022 (Wikipedia); fact now says Queensland only, skull "estimated at over 2 metres" (2.2–2.85 m).
- triops — Wikipedia: pre-Cenozoic fossils "do not belong to Triops"; a 2017 paper finds "no support for the living fossil concept". Reworded to "tadpole shrimp that look much like them were already around more than 200 million years ago".
- slit-shell-snail — Pleurotomariidae have a continuous record from the Upper Cambrian (Wikipedia), i.e. about 500 million years, not "more than 500". Reworded; collectors' prize kept (famous).

---

## Prompt-fit calls (what I would remove, and what I would keep)

In the patch (removed)

- hadal-animal: xenophyophore (baitball) and foraminifera (twilight) — single-celled protists on a prompt that says "Name an animal". Prompt keeps 30 answers and its hadal.
- river-dolphin: vaquita (twilight) — a marine porpoise of the upper Gulf of California; hectors-dolphin (twilight) — shallow coastal marine. Prompt keeps 26. Commerson's dolphin kept: it does use estuaries and river mouths.
- venomous: port-jackson-shark (midnight) — Wikipedia: spines "are rumored to be venomous". Prompt keeps 33.

Kept (defensible for a trivia game)

- Orca and gray whale on arctic-animal: both occur in the Chukchi/Beaufort seas. Sperm whale on polar-cetacean: bulls range to the ice edge in both hemispheres.
- Eagle, cownose, bat and butterfly rays on stingray-species: all are Myliobatiformes (the stingray order) with tail spines.
- Caribbean monk seal on pinniped, Steller's sea cow on marine-mammal-not-cetacean: species that existed; the facts say they are extinct.
- Māui dolphin on dolphin prompts: a subspecies, but a name players will type.
- Vampire squid on squid-species; hermit/king/yeti/porcelain/coconut crabs on crab-species; mantis shrimp and squat lobster on lobster-shrimp: all carry the name even if not true members. Rejecting them would feel wrong.
- Sperm whale and Japanese spider crab on deep-not-fish: 2,000 m and 600 m respectively.
- Raja Ampat and Lord Howe Island reef on reef-system; Black Sea and Sea of Azov on mediterranean-sea (the IHO's "Mediterranean Region" formally includes both).
- Electric eel on eel; striped bass and barramundi on grouper-snapper-bass ("striped sea bass", "Asian sea bass"); saltwater crocodile on long-lived (70+ years); giant pyrosome and Praya dubia on giant.
- Totoaba (US ESA endangered, CITES I, IUCN now Vulnerable) and leatherback (IUCN Vulnerable globally, several subpopulations Critically Endangered, US ESA endangered) on endangered.
- Silfra on dive-site ("famous dive site"); freshwater living fossils (gar, bowfin, sturgeon, bichir, arowana, lungfish) — "often called a living fossil" is about the label, not the habitat; generic shark/crab/snapper on nocturnal; great white/blacktip/blue shark on colour-name.
- Freshwater animals and the two plants (Caulerpa taxifolia, wakame) on invasive: the prompt says "sea or freshwater creature"; the seaweeds are a stretch but harmless.

Recommended prompt-text edits instead of removals (not patchable in this schema)

- electric: "Name a sea creature that produces electricity or senses electric fields" — the tidepool answer (electric eel), electric catfish and platypus are all freshwater. Suggest "Name a creature that produces electricity or senses electric fields." Removing them would reject the first answer most players type.
- deep-shipwreck: Lusitania (93 m, tidepool), Britannic (120 m), Andrea Doria (73 m) and Estonia (80 m) are not on the "deep seabed" in any oceanographic sense. Suggest "Name a famous shipwreck still lying on the seabed."
- sunken-ship: USS Arizona and USS Maine sank in harbour, Rainbow Warrior in Auckland harbour, Bounty was burned at Pitcairn, Queen Anne's Revenge ran aground, Costa Concordia was refloated. Suggest "Name a famous ship that sank."

## Spot-check sample (90 entities, seed 20261102)

Corrected (fact in patch)

- bougainville-trench — Wikipedia places the trench "around the south of New Britain and west of Bougainville Island"; the 9,140 m Planet Deep belongs to the New Britain section. Reworded.
- bristle-worm — "collected from the mud at the bottom of the Challenger Deep" is not supported (the 2005 Challenger Deep sediment haul reported foraminifera); polynoid polychaetes are recorded below 10,000 m (Wikipedia, Hadal zone). Reworded to "trench floors more than 10,000 metres down".
- japanese-sea-lion — last reliable records in the 1950s, but Wikipedia records a juvenile captured in 1974 off Rebun Island. Reworded to include both.
- smooth-handfish — IUCN listing reversed 2021 (see worst errors).
- dragon-hole — no longer the deepest blue hole (see worst errors).
- mediterranean-damselfish, mediterranean-parrotfish — Lessepsian damselfish (Abudefduf) and parrotfish (Scarus ghobban) now occur in the Mediterranean; "only" changed to "only native".
- giant-warty-squid — 2.3 m specimen confirmed; toothfish predation not confirmed on Wikipedia (sperm whales, sharks, albatrosses are). Reworded.

Verified (fact and every prompt placement hold)

american-bullfrog, opabinia (laughter at Whittington's first presentation; 1972 Oxford meeting per Gould), bay-of-pigs, heron, crab-boat, lingula, common-cuttlefish, lancelet, beadlet-anemone, frogspawn-coral, boxer-crab, falkland-current, blue-corner, australian-humpback-dolphin (Sousa sahulensis, 2014), crown-of-thorns-starfish, slender-snipe-eel (1.5 m), hudson-canyon, apache-trout, gulf-of-bothnia, kelp-fly, lamp-shell, japan, portuguese-man-o-war (tentacles typically 10 m, up to 30 m), bengal-tiger, marine-virus (10 million per ml; kill 20% of microbial biomass daily), sydney-rock-oyster (NSW DPI: "Australia's oldest ... aquaculture industry", Gwawley Bay 1872), cabo-pulmo-national-park, jean-michel-cousteau, fish-larva, kelp, abidjan (Vridi Canal 1951), porcupine-ray, sanganeb-atoll (UNESCO 2016, only atoll in the Red Sea), leaf-scaled-sea-snake (Shark Bay, December 2015), vent-sea-spider, albatross, mediterranean-monk-seal (under 1,000), barents-sea, hammerhead-shark, bar-tailed-godwit (B6, 13,560 km, 11 days), sponge (Asbestopluma at 9,990 m, Philippine Trench, Vityaz 1975 — Guinness), strait-of-malacca, deepsea-challenger, predatory-tunicate, flatback-sea-turtle, atlantis, right-whale, marine-flatworm, akagi (5,490 m, October 2019), great-white-shark, atlantic-salmon, nile-perch, oceanic-whitetip-shark, green-neon-tetra, cornetfish, red-sea-bannerfish, chilean-jack-mackerel (c. 5 Mt in 1995), ross-seal, american-crocodile, mid-atlantic-ridge, slipper-limpet, black-coral (Leiopathes 4,265 years), haddock, gakkel-ridge, dragon-wrasse, denises-pygmy-seahorse, clawed-armhook-squid (Seibel et al. 2005: first observation of egg brooding in a squid; 2,000–5,000 eggs, 6–9 months), red-scorpionfish, globe-skimmer-dragonfly (14,000–18,000 km), southern-stingray, olive-flounder, dwarf-seahorse (Guinness slowest-moving fish), reef-triggerfish, jellyfish, spiny-lobster, oscar, geoduck (168 years), gulf-menhaden, sipadan, flemish-cap, sea-pansy (Renilla luciferase and GFP), north-pacific-right-whale (30–35 in the eastern North Pacific), goliath-tigerfish (Wikipedia: attacks on crocodiles and humans reported), eugenie-clark, brown-pelican, trichodesmium, kuroshio, asian-clam.

Strict-criteria prompts, every answer checked for fit: giant (>8 m), fast-fish (>40 km/h), long-lived (>50 years), tiny-fish (<5 cm), below-1000m, hadal-animal (>6,000 m), shark-deep (>200 m), extinct, endangered, water-named-person, breathes-air, electric, sound. Findings: the hadal removals above; grenadier at 7,012 m (Coryphaenoides yaquinae), stalked crinoids over 9,000 m in the Izu-Ogasawara Trench (Zoological Science 2009), brittle stars at 6,640 m in the South Sandwich Trench (Jamieson et al. 2021), dumbo octopus at 6,957 m in the Java Trench, Calypso Deep 5,109 m (2020) — all confirmed. Everything on water-named-person is genuinely named after a person (checked all 35, including Lincoln Sea for Robert Todd Lincoln and Lancaster Sound for Sir James Lancaster). Taimen "more than 50 years" holds (at least 55 years).

## Tier sanity check (five prompts: shark-species, explorer, sea-reptile, whale-species, sushi; jellyfish, crab-species, food-fish also glanced at)

In the patch

- shark-species: goblin-shark baitball → twilight. A goblin shark is not something a typical adult says second; nurse, basking, lemon and blue sharks (all at reef) are far more familiar.
- explorer: christopher-columbus reef → tidepool and james-cook baitball → tidepool; james-cameron and sylvia-earle tidepool → baitball. Columbus at tier three was clearly wrong for "name a famous ocean explorer". Tidepool stays at five.
- sea-reptile: sea-snake baitball → tidepool (one of the four obvious groups), leatherback-sea-turtle tidepool → baitball (third turtle at tidepool). Tidepool stays at five.

Looked right: whale-species, sushi, jellyfish, crab-species, strait, current, coral-type. Optional, not patched: on food-fish, mahi-mahi (baitball) above haddock, mackerel, trout and herring (reef) reads as US-centric for a British-spelling bank; swap mahi-mahi → reef and haddock → baitball if the audience is UK-weighted.

## Other things noticed (not patched)

- Orphan after patch: `xenophyophore` is no longer on any prompt (validator warning only). It fits deep-not-fish ("deep-sea creature that is not a fish") at midnight; add it there by hand.
- Duplicate entities for one species: gray-whale/grey-whale, leatherback-sea-turtle/leatherback-turtle, piranha/red-bellied-piranha, market-squid/california-market-squid, betta/siamese-fighting-fish, angel-shark/angelshark, blue-starfish/blue-sea-star, bonnethead/bonnethead-shark, bluntnose-sixgill-shark/sixgill-shark, bobtail-squid/hawaiian-bobtail-squid and more (482 name/alias collisions bank-wide). Matching is per prompt, so nothing breaks, but the same species shows two different "Did you know" facts and two names in the player's logbook. Worth a merge pass.
- Pre-existing validator warning: alias "Laticauda" is shared by sea-snake and sea-krait on indian-ocean.
- `gray-angelfish` keeps the American "gray" because that is the species' common name; fine.
- Calypso Deep facts (ionian-sea, hellenic-trench) say "about 5,100 metres", which matches the 2020 direct measurement of 5,109 m, so they were left alone.
