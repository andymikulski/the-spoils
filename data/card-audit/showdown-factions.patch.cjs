// Encodes the two Showdown faction cards (docs/rules/showdown-rules.md, SD-EA 1-11, SD-SLE 1-5).
//
//   node scripts/patch-cards.cjs data/card-audit/showdown-factions.patch.cjs
//
// Idempotent: it assigns whole fields, so running it twice changes nothing.

const EVIL = "9dc309f4-d43f-4515-841e-ed982ce026e7";
const SLE = "089a2d63-c9b9-4ad7-8c51-1d0d79a0dfbb";

const selected = (id) => ({ type: "selected", id });
/** X - 1, X being the number of opponents at the start of the game (SD-EA 1). */
const xMinusOne = { type: "add", values: [{ type: "opponentCountAtStart" }, -1] };
const ownTurn = { type: "isActivePlayer" };

/** "Play a resource": the user picks a card from their hand and plays it as a resource (face up if it can be). */
const playAResource = {
  type: "chooserSelectsTarget",
  chooser: "controller",
  declaration: { id: "r", selector: { controller: "self", zone: "hand" }, count: 1, optional: false },
  effects: [
    {
      type: "if",
      condition: { type: "targetExists", target: selected("r") },
      effects: [{ type: "playResource", target: selected("r"), faceDown: "auto" }]
    }
  ]
};

/** "Claim one card in the Temptation Pile" (mandatory while the pile has a card). */
const claimOneTemptation = {
  type: "chooserSelectsTarget",
  chooser: "controller",
  declaration: { id: "t", selector: { zone: "table", showdownPile: "temptationPile" }, count: 1, optional: false },
  effects: [
    {
      type: "if",
      condition: { type: "targetExists", target: selected("t") },
      effects: [{ type: "claimHeroCards", claimer: "controller", from: "selected", selected: "t" }]
    }
  ]
};

module.exports = ({ patch }) => {
  patch(EVIL, (card) => {
    const faction = card.faction;
    // INFLUENCE = 15 + (10 * X)
    faction.startingInfluence = 15;
    faction.influencePerOpponent = 10;
    // STARTING RESOURCES: any 1 + X staple resources
    faction.setup.startingResources = { count: 1, countPerOpponent: 1, stapleOnly: true };
    // DEVELOP RULE: draw a card or play a resource, repeated X - 1 times (X develops in all)
    faction.turn.develop.usesPerOpponent = true;
    // DARING GAMBIT
    faction.daringGambit = { damage: 7 };
    const [draw, resource] = faction.abilities;
    faction.abilities = [
      draw,
      resource,
      {
        id: "evil-enticement",
        name: "Enticement",
        type: "activated",
        // COST: Use this only during your turn, and only once per turn.
        condition: ownTurn,
        usesPerTurn: 1,
        costs: [],
        effects: [
          { type: "draw", player: "controller", amount: xMinusOne },
          playAResource,
          { type: "heroDeckToTemptationPile", count: 1 }
        ]
      }
    ];
  });

  patch(SLE, (card) => {
    card.faction.abilities = [
      {
        id: "give-in-to-temptation",
        name: "Give In To Temptation",
        type: "activated",
        usableBy: "heroes",
        condition: ownTurn,
        usesPerTurn: 1,
        costs: [{ type: "payResources", amount: 2 }],
        targets: [{ id: "c", selector: { type: "character", controller: "otherHero" }, count: 1 }],
        effects: [{ type: "takeControl", target: selected("c"), controller: "villain" }, claimOneTemptation]
      },
      {
        id: "spring-forth-my-burly-protector",
        name: "Spring Forth My Burly Protector!",
        type: "activated",
        usableBy: "heroes",
        costs: [{ type: "payResources", amount: 6 }],
        effects: [{ type: "claimHeroCards", claimer: "controller", from: "heroDeckTop", count: 1 }]
      },
      {
        id: "teamwork",
        name: "Teamwork",
        type: "activated",
        usableBy: "heroes",
        costs: [{ type: "payResources", amount: 2 }],
        targets: [
          { id: "card", selector: { controller: "self" }, count: 1 },
          {
            // "Choose another player": pick another player's faction card (the shared Alliance card is not a player).
            id: "player",
            selector: {
              type: "faction",
              controller: "any",
              conditions: [
                { type: "not", condition: { type: "targetControlledBy", player: "controller" } },
                { type: "not", condition: { type: "isCard", other: "source" } }
              ]
            },
            count: 1
          }
        ],
        effects: [
          {
            type: "takeControl",
            target: selected("card"),
            controller: { type: "controllerOf", target: selected("player") }
          }
        ]
      }
    ];
    // YOUR TRUE COLORS ARE REVEALED
    card.behavior = {
      ...(card.behavior || {}),
      abilities: [
        {
          id: "true-colors",
          name: "Your True Colors Are Revealed",
          type: "triggered",
          event: "turnStarted",
          // The shared Alliance card is the Villain's (SD 5), so its controller is the Villain; "villain" itself
          // would throw in a classic game, where this faction card is an ordinary one.
          condition: { type: "eventPlayerIs", player: "controller" },
          effects: [
            { type: "addCounter", target: "source", counter: "token", amount: 1 },
            {
              type: "if",
              condition: { type: "counterCompare", target: "source", counter: "token", operator: "=", value: 7 },
              effects: [{ type: "revealAllegiances" }]
            }
          ]
        }
      ]
    };
  });
};
