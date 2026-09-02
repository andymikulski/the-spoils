#!/usr/bin/env node
/* author-fidelity-fixes.cjs — tighten the behaviour JSON of cards whose
 * printed text wasn't fully obeyed. Existing vocabulary only (no engine
 * change). Patches every printing of each named card.
 *
 *   node .work/author-fidelity-fixes.cjs [--dry]
 *   then: npm run sync-cards
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const CARDS = path.join(ROOT, "data", "cards.json");
const DRY = process.argv.includes("--dry");

const cards = JSON.parse(fs.readFileSync(CARDS, "utf8"));
const byName = new Map();
for (const c of cards) {
  if (!byName.has(c.name)) byName.set(c.name, []);
  byName.get(c.name).push(c);
}
const touched = [];
const patch = (name, fn) => {
  const list = byName.get(name);
  if (!list) throw new Error(`no card named ${name}`);
  for (const c of list) {
    fn(c);
    touched.push(`${c.set} / ${c.name}`);
  }
};

const tExists = id => ({ type: "targetExists", target: { type: "selected", id } });
const sel = id => ({ type: "selected", id });

// ---- Intellectual Reliquary -------------------------------------------------
// "Look at the top 3. You may choose a tactic among them and take it to hand.
//  Put the remaining cards on the bottom in any order."
patch("Intellectual Reliquary", c => {
  c.behavior.abilities = [
    {
      id: "imbibe",
      type: "activated",
      costs: [
        { type: "payResources", amount: 1 },
        { type: "deplete", target: "source" }
      ],
      targets: [
        {
          id: "pick",
          selector: { controller: "self", zone: "deck", type: "tactic", fromTop: 3 },
          count: 1,
          optional: true
        }
      ],
      effects: [
        { type: "if", condition: tExists("pick"), effects: [{ type: "moveCard", target: sel("pick"), to: "hand" }] },
        {
          type: "lookAndReorder",
          player: "controller",
          to: "bottom",
          count: { type: "conditional", if: tExists("pick"), then: 2, else: 3 }
        }
      ]
    }
  ];
});

// ---- Gilda, Mother of Gideon ---------------------------------------------------
// peek: "look at the top 2. You may reveal a tactic among them -> void.
//        Put the remaining cards on TOP in any order."
patch("Gilda, Mother of Gideon", c => {
  const peek = c.behavior.abilities.find(a => a.id === "peek");
  delete peek.effects;
  peek.targets = [
    {
      id: "tac",
      selector: { controller: "self", zone: "deck", type: "tactic", fromTop: 2 },
      count: 1,
      optional: true
    }
  ];
  peek.effects = [
    { type: "if", condition: tExists("tac"), effects: [{ type: "moveCard", target: sel("tac"), to: "void" }] },
    {
      type: "lookAndReorder",
      player: "controller",
      to: "top",
      count: { type: "conditional", if: tExists("tac"), then: 1, else: 2 }
    }
  ];
});

// ---- Warmachine Smelder -----------------------------------------------------
// LIFE'S WORK: "...reveal it. You may deploy that card for free. If you
//   don't, put it into your hand."
patch("Warmachine Smelder", c => {
  const lw = c.behavior.abilities.find(a => a.id === "lifeswork");
  const pick = lw.effects.find(e => e.type === "chooserSelectsTarget");
  pick.effects = [
    {
      type: "chooserSelectsOption",
      chooser: "controller",
      options: [
        {
          label: "Deploy it for free",
          effects: [{ type: "deployFromZone", player: "controller", target: sel("masterwork"), free: true }]
        },
        {
          label: "Put it into your hand",
          effects: [{ type: "moveCard", target: sel("masterwork"), to: "hand" }]
        }
      ]
    }
  ];
});

// ---- Ecto-Distillation ----------------------------------------------------------
// "An opponent may search your deck for any number of copies of the card.
//  If they do, put THOSE into your discard pile." -> move exactly the picks.
patch("Ecto-Distillation", c => {
  const body = c.behavior.abilities.find(a => a.id === "body");
  const oppPick = body.effects.filter(e => e.type === "chooserSelectsTarget").find(e => e.chooser === "opponent");
  oppPick.effects = [{ type: "forEach", selected: "opp", effects: [{ type: "moveCard", target: sel("__candidate"), to: "discard" }] }];
});

// ---- A Death Fit for a King -----------------------------------------------------
// EXTRA COST: "Pick a character with the UNIQUE keyword ... OR pick a
//   character in an OPPONENT's discard pile."
patch("A Death Fit for a King", c => {
  const body = c.behavior.abilities.find(a => a.id === "body");
  const cand = { type: "selected", id: "__candidate" };
  body.targets[0].selector.conditions = [
    {
      type: "or",
      conditions: [
        {
          type: "and",
          conditions: [
            { type: "targetInZone", target: cand, zone: "play" },
            { type: "hasUnique", target: cand }
          ]
        },
        {
          type: "and",
          conditions: [
            { type: "targetInZone", target: cand, zone: "discard" },
            { type: "targetOwnedBy", target: cand, player: "opponent" }
          ]
        }
      ]
    }
  ];
});

// ---- Eccentric Inquisition ---------------------------------------------------
// "Put ALL tactics revealed this way into the void" — not a choice. Force it
// by making the count exactly the number of matching tactics.
patch("Eccentric Inquisition", c => {
  const body = c.behavior.abilities.find(a => a.id === "body");
  const t = body.targets.find(d => d.id === "voided");
  t.count = { type: "count", selector: { ...t.selector } };
  t.optional = false;
});

console.log(`patched ${touched.length} printings:`);
for (const t of [...new Set(touched)]) console.log(`  ${t}`);

if (DRY) console.log("(dry run — nothing written)");
else {
  fs.writeFileSync(CARDS, JSON.stringify(cards, null, 2) + "\n");
  console.log("wrote data/cards.json");
}
