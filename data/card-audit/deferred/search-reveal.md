# Search "...and reveal it"

Status: done. 107 printings turned on.

## Design

- New effect `{ type: "revealCards", selected?: <TargetDeclaration id>, selector?: CardSelector, viewer?: PlayerRef | "all" }`
  (`src/types/effects.ts`, handled in `SpoilsEngine.resolveEffect`). It emits `cardsRevealed`
  (one event per owner + zone) for the cards named by `selected` (the picks of a declaration, the
  same way `forEach.selected` reads them) or matched by `selector`. `viewer` defaults to `"all"`.
  An empty pick (a declined "you may search") emits nothing.
- It is an effect, not a flag on the declaration, because a search is declared in two shapes
  (a `chooserSelectsTarget.declaration` and an ability's `targets[]`, picked at cast time for
  activated abilities) and an effect reveals at resolution in both, in text order: pick, reveal, move.
- Placement rule (see the patch module): insert immediately before the first effect that consumes the
  pick (looking inside `if` branches); if nothing consumes it, first effect of the host list.
- `FactionDefinition.setup.startingDrawSearch.reveal?: boolean` does the same for Unlikely Heroes'
  STARTING DRAW search, which is engine-driven and has no effect list (`factionSetup.ts`).
- Per printing: the patch turns a printing on only when its printed text (`corrections.json[id].text`,
  else the card's `text`) has a sentence containing "search" that, or whose next sentence, says
  "reveal it/them/the card". Reprints that drop the word are left alone (e.g. Master Ritualist 1st
  Edition reveals, Open Beta does not; Cheats McGuillicutty's CHANGE COSTUME does not reveal in either
  printing; I Drink Your Milkshake! only reveals later, unrelated).
- Ecto-Distillation: `found` (all copies the player picks) is revealed; `one` (which revealed copy goes
  to hand) and `opp` (the opponent's own search) are not.
- Not covered (not searches): "look at the top N, choose X and reveal it" (Intellectual Reliquary,
  Gilda, Auspicious Arrival), Rosy Palmer, Meager Research's first sentence ("Reveal the top card of
  your opponent's deck"), Eccentric Inquisition. Done in `other-reveals.md`.

## spoils-game

`cardsRevealed` already reached the game log ("X reveals Y from deck", kind `draw`, also in the
Recent ticker). Added a `reveal` moment to `useTableEventQueue` / `TableEventQueue`: the revealed
card faces held centre stage (spotlight styling), sequenced with the other table moments, and holding
the AI driver while it shows. Shown to the player the event is for, except the one who revealed to
everyone when they already knew the cards (`knownToRevealer`, see [reveal-followups.md](reveal-followups.md)). A reveal whose viewer is only the opponent is not shown to the revealer.

## Files

spoils-db:
- `src/types/effects.ts` (`revealCards`), `src/types/cards.ts` (`startingDrawSearch.reveal`)
- `src/engine/SpoilsEngine.ts` (`case "revealCards"`), `src/engine/factionSetup.ts`
- `src/engine/__tests__/search-reveal.test.ts` (new), `src/engine/__tests__/card-data-integrity.test.ts`
  (`revealCards` added to the known type tags)
- `data/card-audit/deferred/search-reveal.patch.cjs` (the patch module; re-runnable, idempotent:
  `node scripts/card-audit/patch-cards.cjs data/card-audit/deferred/search-reveal.patch.cjs`)
- `data/cards.json` and `src/data/cards.js` via the locked tool only
- `RULES.md`, `BEHAVIORS.md`

spoils-game (packages/web/src):
- `useTableEventQueue.ts`, `components/TableEventQueue.tsx`, `styles.css`
- `__tests__/TableEventQueue.test.tsx`

## Tests

- `src/engine/__tests__/search-reveal.test.ts`: synthetic (reveal before the move, no reveal without the
  effect, declined search, no candidates, multi-pick one event, viewer, opponent's deck, two owners,
  triggered `targets` shape, selector form, `startingDrawSearch.reveal`) and catalog data
  (every printing with the effect prints "reveal"; every printing whose search sentence prints a reveal
  has it; declaration ids exist; Master Ritualist 1st Edition vs Open Beta end to end; Servile Centipede
  2nd Edition end to end).
- web `TableEventQueue.test.tsx`: opponent sees the faces and the caption then it clears; the revealer is
  not interrupted; an opponent-only reveal is not shown to the revealer.

If another session rewrites a card's behavior and drops the effect, the data test above fails; re-run
the patch module.

## Printings turned on (107)

**1st Edition** (10)

- 1d8d7483-283a-45d5-b04f-5edaf7c9fe78 Arcana Experiment
- b9551400-f15c-4a8f-a2e1-a35a202e773d Ecto-Distillation
- b25c8c8b-1116-4b8b-95cb-828061d9577b Master Ritualist
- 5f6c6574-27db-4149-a19b-fd67dc589c1b Servile Centipede
- 9d3a3159-52c7-428a-b4ed-db2719792304 A Series of Tubes
- a525afe9-e0c7-4502-b713-4e394b0ae77e Basic Node
- dd3b2a43-ee3e-432f-86ef-0b3064abf691 Epiphanal Mechanic
- f7ddc8f5-5819-4855-a12a-0df4543c6775 Hub Node
- 97a5cad1-4663-414c-b230-9348968f6fb1 I Got the Gear!
- 300b1274-898a-4769-8422-ab07c00ca51e Meager Research

**1st Edition Part 2** (6)

- 8bdf8634-d49d-43f6-b267-15978fab6227 Ritual of the Ominous Urn
- c1c2efc5-f032-4c05-89fa-ab3c97a73aba Unnatural Alteration
- 210c93ab-9cc2-45a8-9e8e-0aec15e38f54 Keen Stratagem
- 3dd0c05f-dd1d-49a2-b7b5-ab17f0ee8bd3 Elite Team Registration
- 8ac37971-303b-4ec6-bf9b-a09c1883a44a The Whatever Device
- b0760e4d-f149-4fc6-a698-8e405e825036 Assimilation Center

**2nd Edition** (16)

- 4300e226-bceb-4fcc-b9d0-097971b17dc4 Arcana Experiment
- ab9cdd87-c394-4108-a787-805193911891 Ecto-Distillation
- 0d9750c3-d284-4097-88bd-8c20bb922900 Ritual of the Ominous Urn
- 6d042680-d2e0-42a0-a99c-600d30c8625d Servile Centipede
- 68679306-bedf-4fff-86f0-4e156ad5b426 Unnatural Alteration
- 7a8cb27e-6cf9-41ed-b051-a69557c821df Keen Stratagem
- d17c2c61-97a1-4290-b612-c8035c9de9be 700160x 31f
- 6603117c-3807-4dd2-b834-fa1deb3a9418 A Series of Tubes
- 874f78fc-7fef-4536-8196-4d6c8bdd566d Basic Node
- 663dde1e-80bf-4ec0-bffb-e916af39944a Contriving Engineer
- 6a573a82-ebd4-45a2-91b2-fc2029132b6b Elite Team Registration
- b535b316-ed94-435f-b6fd-2042dfdc6f49 Hub Node
- 6b7d880a-9bd7-4fd5-a940-883c6e24f59d The Whatever Device
- 65ebb568-f0c8-4bd4-a75a-209ff0c36a7e Heist Planner
- fb604d54-0aa5-40b5-9430-9d163e03fcc9 The Billionaire
- 00881fe6-5de2-4709-ab6f-bffc7e76c525 Assimilation Center

**Holy Heist** (10)

- 7f75ce4c-b81e-45a9-973a-1bbe50fb43e4 Profane Proposal
- 0178a457-888f-4e19-93c8-6475173566b4 Early Investment
- 91d07791-dd91-4862-9345-d06bbc73a06b 73ch!
- 15172964-a78f-4d08-bf1c-5b80eb02f544 Node in a Box
- 6d385d6a-39e5-4b8f-b68b-3519ca99268a Cheats, the Dirty Rotten
- 1debbb17-6f36-47b4-85d7-cf4d91d320d7 Unexpected Transformation
- b8166db8-01ba-4103-bfee-dfece934c330 Gathering of Unlikely Heroes
- 5f7c48c3-2413-4f85-87f3-8c9ed04046ec Overly Eager Exemplar
- 710d5ee7-a234-46dc-9e78-8d49a146c6ec Unlikely Heroes
- 8d9ffff2-e3a6-4caf-be4f-4dc6e7241a0d Lugubrian Council Expedition Division

**Open Beta** (6)

- 6e63449c-4363-494b-b90a-db1147b4b9a1 Arcana Experiment
- d161dd99-3bd1-4fdb-9fdd-924a70f7c0f4 Servile Centipede
- b6b084f1-d30f-45eb-96bc-6bb8e78abb71 Basic Node
- a774110a-7061-467e-ab00-ad43c24e5764 Hub Node
- 979d3623-d758-4c61-b765-6e8b7b1eb4d5 I Got the Gear!
- d25a15e6-3f64-484a-bc42-5121528329c7 Meager Research

**Seed** (7)

- 9d9e48cb-83f4-4b81-8a86-1a0c2b18e282 Ensorcelled Familiar
- ae3fd7e6-7886-4529-9d27-54617d25826c Karmic Cake
- 46d55ff2-289d-4722-8ce0-6c5aba7e46c6 The Currency Bazaar
- a691d84a-b0b0-4590-9333-698c448e3062 Treasure Brokerage
- 9ccc40b6-2008-4e25-af2f-4ef6862c3687 Aristocratic Artificer
- db82f8c3-503c-405c-b067-223752b2cad3 Multi-Attachment Man
- 3ef1aa24-c030-4c3f-8970-1c291e8c8a79 Workshop

**Seed 2** (7)

- 4bbe221f-8085-43fe-b1a7-70c332d10958 Inadequate Wand
- 599db9fe-dcc4-4812-b91d-9957d2ce504d Dowsing Cleric
- 3a8414ae-466f-48ea-b429-7b562830015b Clay Node
- 194bea41-c877-4b84-a14d-80b8caba8cb8 Lab of Luxury
- 1a08f63f-1eb2-4592-a78e-dd83820fcbd7 Party Clowns
- 351670b7-13a8-4398-a4f9-416e5ec9eb31 Crest of Obsession
- 9b44d317-14f6-4647-96cb-4a6a5166dc50 Crest of Rage

**Seed 3** (3)

- 0833ee0d-bce2-43b5-bb59-c01271b2aad5 Cowslaw
- dc1f0f31-d593-4619-8af1-9a66cd544e5c The Stone of Triumph
- ce1ccf05-7a09-4363-b3b2-67d3d28b1973 The Society of Magical Propriety

**Seed Saga** (17)

- 605554df-72a7-4b72-91cc-f6983165d620 A Death Fit for a King
- 2fbbeafd-5dc5-4d30-88cd-facfb457b22e Ensorcelled Familiar
- f2080f61-f682-45fb-8a2c-66e6026a4d09 Inadequate Wand
- 538f3a18-9e59-41e4-af8c-ed6bd2a50990 Dowsing Cleric
- 91cde202-1a5d-4f12-a788-72e9a5a67ed9 Karmic Cake
- 37c490de-cadf-4e68-91a4-4444f2df1eed Mau Caravan
- 0b93e900-74f6-4e0e-a721-d3988b367807 The Currency Bazaar
- 8f6f62a4-64ee-402d-be0e-1ac69b151b84 Treasure Brokerage
- beeac089-6c5b-41bb-9965-ed0639df85ef Aristocratic Artificer
- 3832de4f-e332-4efc-884f-60c6fa338e86 Clay Node
- e9d01959-e9bf-4121-b066-88464172b2c8 Lab of Luxury
- 62fd5672-18f8-47db-8cff-a9f0363ca04c Multi-Attachment Man
- 3be88b1b-8fd8-4c46-82e7-54f832a65e30 Warmachine Smelder
- 2fddabff-271a-463f-be1d-bfe4463eb2dc Workshop
- a97db794-de63-43b8-8538-6f98222b19c2 Party Clowns
- 5989ea37-35f7-443c-9b79-64ce0475309c Well Laid Plans
- d1e103cf-9aed-466c-abdf-f856469e5ffa Legions of Chaos

**Shade of the Devoured Emperor** (9)

- e0a7e6af-da4e-4442-ade8-d1b0547deb11 Expedition Endeavour
- e2b65004-fb6d-40f2-8f4c-18ee79e934fd The Lugubrian Council of Quotidian Affairs
- 94a47bcb-c174-47a9-a293-8183632b2fac Goldmau Sacks Representative
- e0b38a11-024e-47b7-a886-a22221328fea Mau Strategist
- 78e8d502-b066-4f29-a690-dd202713bcc8 Mr. Fetch
- f8953a4a-6a5a-4104-bfbc-4626645dc766 Clockman Junk Picker
- ba4a554e-4fbb-42b4-8e63-3f5f200104e5 Runic Map
- 506f383f-ef35-467b-8554-dd6b4b9729df Shade of the Devoured Emperor
- cb39b1ed-d160-4760-8c2d-5337b9ea74ec Shriever Breeding Program

**Ungodly Mess** (16)

- 85d845d7-6c4f-4d53-90d1-d15a67e3598f Little God of Answers
- a4f3c203-5e83-4af9-9bda-6d85d8413732 Quipster D'Genie
- a59feec7-7291-40f8-af99-8ca84aa2cb8c Voidal Tactician
- 9c0e2ffb-b580-402f-98a3-3fb892384326 Zenobia's Tower
- cabcf2b8-f2c4-4dd8-ba1b-2d239b26f3da Key to the City
- 866cd820-dd86-4410-9c0e-0c0541e81e08 Strategic Vision
- 22fd7a13-1319-40e8-8e95-33e90cc5d376 Acrolosian Outpost #30016968A
- a9c7ba1c-1080-4a81-932a-ab573c7a193f Frantic Jerryrigging
- 0de9e2fd-df8a-45a0-9928-c8bfb77a4a72 Jo Ciendeilio, Iron Born
- 68bc2d1d-f025-4a2c-ae8c-584dc335f6eb Last Minute Weaponization
- 6d5dffbe-9724-4ed6-89f7-58189567f5af Zenobia, Artificer
- 2df3c789-ac84-4aba-9652-968cefb669f4 Zenobia, Artificer
- 8d5dd336-23ad-4efd-9ce0-a94d58ca72e8 Direstock Stronghold
- f3c70039-bc5b-4aa5-b7fa-40705949b8b3 Rudo Mangod, Fightful Adonis
- ad41e756-6b51-45ae-9b0c-5e94a5e316c4 Contriving Engineer
- 9b7a8729-2116-4973-a0ee-78d19555610f Multi-Attachment Man
