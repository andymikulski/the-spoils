// Seed 3 sampler — NOT a legal tournament deck. A UI / feature-testing
// grab-bag: one Seed 3 faction card + one copy of every Seed 3 card that
// exercises a new engine mechanic (flip-up, replacement, nameValue,
// mayPay/optional cost, tokens, RECUR/activate-from-zone, forEachPlayer,
// deploy-history, meta-use-ability, ...), padded with 1st-Edition basic
// resources across all five icons so every one of them is castable.
// Regenerate the sibling seed3-sampler.json from this + data/cards.json.
export default [
  // faction (mixed in, like the arcanist/warlord precons)
  "9dc309f4-d43f-4515-841e-ed982ce026e7", // The Evil Alliance

  // -- Seed 3 new-mechanic cards (one each) --
  "0833ee0d-bce2-43b5-bb59-c01271b2aad5", // Cowslaw — FLIP UP + sacrificeSelected + search
  "6affffa0-13f7-4085-adb4-2b8ea1a0a2fa", // Delicious Strawberry Flavored Death — FLIP UP + trade condition
  "91803a23-9aff-4665-87cf-ff3e40580ede", // The Stone of Shame — mandatory replacement (moveToZone->destroy)
  "0b67c755-4053-4bfb-9aef-e3a990501e0d", // Giada, the Elegant — optional replacement (by: opponent) + setDamage
  "e2f64e14-2f97-4905-8bb0-8bea33994928", // Port Manteau — nameValue + subtypeVar cost modifier
  "dc1f0f31-d593-4619-8af1-9a66cd544e5c", // The Stone of Triumph — optional-cost-in-effect + cardNameEquals
  "b91d33d1-aeed-4953-b57b-463204b25bc6", // Unscrupuls of Victory — createTokens + resourceIcons
  "4189d9eb-5a42-4fd6-bc2b-efd9e6f40ccb", // Prestige Inversion — activate-from-zone (RECUR) + hasUnique
  "25fc8abf-08b6-4afb-bdbd-a7db7c29e1d9", // Anatidaephobia — respondingTo + hard play-time cost / FLIP UP
  "c9801386-03b5-4348-8706-f81fec9819bd", // Geiseric, the Souleater — optional replacement + deck-position dig
  "452bed36-af64-4986-905b-6074fd01437b", // Shieldmane Grandchest — damageModifiers
  "b57044fc-e7a2-409d-bbf2-2dbe4e93519e", // Axeclaw Grandchest — deckPosition ref + moveCard position
  "fe7095e0-d918-420c-9303-fbc5054d2564", // Community Chest — forEachPlayer + bottomedInMulligan
  "d23a3fbd-0bf3-4937-9b29-570c55a418b8", // Spatchcocking — forEachPlayer + activate-from-zone
  "d1fc04ec-fef0-4031-8e4c-9ce7c1273015", // Pony Slaystation — location activated abilities
  "febadb33-11cf-4dec-815b-5e86d03488f0", // Hilarious Refrigerator Alarm — deploy-history + tokens + terminate
  "d5a76074-c837-4279-8f74-bef9e4878b92", // Intriguing Mezzanine — non-tactic EXTRA COST + dealDamage cost + restore-restriction
  "4e50b7ed-2a4e-4bd7-aac3-fbc97b2574c7", // Notion Sickness — useTargetAbility

  // -- 1st-Edition basic resources (5 icons) --
  "0c287282-82cf-4602-b37d-35d1bbea519c", // Obsession
  "0c287282-82cf-4602-b37d-35d1bbea519c",
  "0c287282-82cf-4602-b37d-35d1bbea519c",
  "0c287282-82cf-4602-b37d-35d1bbea519c",
  "0c287282-82cf-4602-b37d-35d1bbea519c",
  "61766da9-6482-4ecb-8306-becda47294ec", // Greed
  "61766da9-6482-4ecb-8306-becda47294ec",
  "61766da9-6482-4ecb-8306-becda47294ec",
  "61766da9-6482-4ecb-8306-becda47294ec",
  "61766da9-6482-4ecb-8306-becda47294ec",
  "3be26b3f-2c78-4d0c-8849-0b4ca48951fd", // Rage
  "3be26b3f-2c78-4d0c-8849-0b4ca48951fd",
  "3be26b3f-2c78-4d0c-8849-0b4ca48951fd",
  "3be26b3f-2c78-4d0c-8849-0b4ca48951fd",
  "ebcdd443-efdf-4a16-a0b9-b1307cd13d0b", // Deception
  "ebcdd443-efdf-4a16-a0b9-b1307cd13d0b",
  "ebcdd443-efdf-4a16-a0b9-b1307cd13d0b",
  "ebcdd443-efdf-4a16-a0b9-b1307cd13d0b",
  "b4ddcf43-e508-4a11-9953-697acdcaf116", // Elitism
  "b4ddcf43-e508-4a11-9953-697acdcaf116",
  "b4ddcf43-e508-4a11-9953-697acdcaf116"
];
