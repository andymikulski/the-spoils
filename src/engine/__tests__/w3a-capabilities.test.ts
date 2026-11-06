// W3a engine capabilities, shown on synthetic cards (no printed text read):
//  * `resourceReveal` -- a `playResource` effect offers "reveal this card as you are playing a resource"
//    (`CardDefinition.revealFromHand`) after the card is chosen and before it enters play (CR 605.1c);
//  * `duplicate` re-asks the copy's play-time picks and lets a modal tactic's duplicate choose a new option (CR 307);
//  * `FactionGameSetupOptions.createdAbility` / `applyCreatedFactionAbility` (`faction.playerCreatedAbility`; the ability is a
//    closed-menu spec since Q51B, see created-ability.test.ts for the menu itself);
//  * `deployFromZone` + `rememberTarget` + `ignoreThreshold` for "void the top card, then you may deploy it".

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  activate,
  bank,
  buildGame,
  character,
  developFaction,
  play,
  resourceCard,
  tactic,
  P1,
  P2
} from "./per-card/_harness.js";
import { resolvePendingResponses, defaultFactionDefinition, factionCard } from "./support/fixtures.js";
import { settleTurnStart } from "./support/develop.js";
import { createTwoPlayerFactionGame, CREATED_ABILITY_ID } from "../../engine.js";
import type { ActivatedAbility, CardDefinition, CreatedAbilitySpec, Effect } from "../../engine.js";

const pend = (engine: { state: { pendingChoice?: unknown } }) =>
  engine.state.pendingChoice as { kind: string; playerId: string; [k: string]: unknown } | undefined;
const answer = (engine: { perform(a: never): void }, playerId: string, choice: Record<string, unknown>) =>
  engine.perform({ type: "resolvePendingChoice", playerId, choice } as never);
const zoneOf = (engine: { state: { cards: Record<string, { zone: string }> } }, id: string) => engine.state.cards[id].zone;

// ---------------------------------------------------------------------------
// resourceReveal
// ---------------------------------------------------------------------------

const revealer = (name: string, extra: Partial<CardDefinition> = {}): CardDefinition =>
  character({ name, cost: 4, threshold: "gg" as never, revealFromHand: { cost: 1 }, ...extra });

/** A character with `go`: "play a resource" (the player picks the card), the way a faction RESOURCE ability does. */
const player = (): CardDefinition =>
  character({
    name: "Player",
    behavior: { abilities: [{ id: "go", type: "activated", effects: [{ type: "playResource" } as Effect] } as ActivatedAbility] }
  });

function revealBoard(opts: { greed?: number; extra?: Parameters<typeof buildGame>[0] extends infer T ? (T extends { cards?: infer C } ? C : never) : never } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "pl", def: player(), owner: P1, zone: "play" },
      { key: "w", def: revealer("Worm A"), owner: P1, zone: "hand" },
      { key: "card1", def: character({ name: "Card One" }), owner: P1, zone: "hand" },
      { key: "card2", def: character({ name: "Card Two" }), owner: P1, zone: "hand" },
      ...bank("greed", opts.greed ?? 3, P1),
      ...((opts.extra ?? []) as never[])
    ]
  });
}

describe("W3a: resourceReveal (reveal a hand card as you play a resource)", () => {
  test("the offer comes after the resource is chosen, before it enters play; accepting deploys the card for its flat cost and the resource still enters", () => {
    const { engine, id } = revealBoard();
    activate(engine, P1, id("pl"), "go");
    assert.equal(pend(engine)?.kind, "chooserSelectsTarget");
    answer(engine, P1, { kind: "chooserSelectsTarget", selected: [id("card1")] });
    const offer = pend(engine)!;
    assert.equal(offer.kind, "resourceReveal");
    assert.equal(offer.playerId, P1);
    assert.deepEqual(offer.candidates, [id("w")]);
    assert.equal(offer.resourceCardId, id("card1"));
    assert.equal(zoneOf(engine, id("card1")), "hand");
    const ready = engine.getAvailableResourceCount(P1);
    answer(engine, P1, { kind: "resourceReveal", cardId: id("w") });
    resolvePendingResponses(engine);
    assert.equal(pend(engine), undefined);
    assert.equal(zoneOf(engine, id("w")), "play", "revealed card deployed");
    assert.equal(zoneOf(engine, id("card1")), "play", "the chosen card still entered play as a resource");
    assert.equal(engine.state.cards[id("card1")].faceDown, true, "a non-resource goes in face-down");
    // The flat cost (1) was paid and the new resource is a ready one.
    assert.equal(engine.getAvailableResourceCount(P1), ready - 1 + 1);
  });

  test("declining plays just the resource; nothing is paid and the card stays in hand", () => {
    const { engine, id } = revealBoard();
    activate(engine, P1, id("pl"), "go");
    answer(engine, P1, { kind: "chooserSelectsTarget", selected: [id("card1")] });
    const ready = engine.getAvailableResourceCount(P1);
    answer(engine, P1, { kind: "resourceReveal" });
    resolvePendingResponses(engine);
    assert.equal(pend(engine), undefined);
    assert.equal(zoneOf(engine, id("w")), "hand");
    assert.equal(zoneOf(engine, id("card1")), "play");
    assert.equal(engine.getAvailableResourceCount(P1), ready + 1);
  });

  test("not offered when the reveal deploy cannot be paid or its icons are not met", () => {
    const poor = revealBoard({ greed: 0 });
    activate(poor.engine, P1, poor.id("pl"), "go");
    answer(poor.engine, P1, { kind: "chooserSelectsTarget", selected: [poor.id("card1")] });
    assert.equal(pend(poor.engine), undefined, "no resources for the flat cost of 1");
    assert.equal(zoneOf(poor.engine, poor.id("card1")), "play");

    const wrongIcons = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "pl", def: player(), owner: P1, zone: "play" },
        { key: "w", def: revealer("Worm A"), owner: P1, zone: "hand" },
        { key: "card1", def: character({ name: "Card One" }), owner: P1, zone: "hand" },
        { key: "card2", def: character({ name: "Card Two" }), owner: P1, zone: "hand" },
        ...bank("rage", 3, P1)
      ]
    });
    activate(wrongIcons.engine, P1, wrongIcons.id("pl"), "go");
    answer(wrongIcons.engine, P1, { kind: "chooserSelectsTarget", selected: [wrongIcons.id("card1")] });
    assert.equal(pend(wrongIcons.engine), undefined, "the revealed card's [G][G] is not met");
  });

  test("a failed reveal deploy (a missing extra-cost pick) is refused and the same choice stays open", () => {
    const needsPick = revealer("Picky", {
      behavior: { onPlay: { targets: [{ id: "t", selector: { type: "character", controller: "opponent" }, count: 1 }] } } as never
    });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "pl", def: player(), owner: P1, zone: "play" },
        { key: "w", def: needsPick, owner: P1, zone: "hand" },
        { key: "card1", def: character({ name: "Card One" }), owner: P1, zone: "hand" },
        { key: "card2", def: character({ name: "Card Two" }), owner: P1, zone: "hand" },
        { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
        ...bank("greed", 3, P1)
      ]
    });
    activate(engine, P1, id("pl"), "go");
    answer(engine, P1, { kind: "chooserSelectsTarget", selected: [id("card1")] });
    assert.throws(() => answer(engine, P1, { kind: "resourceReveal", cardId: id("w") }));
    assert.equal(pend(engine)?.kind, "resourceReveal", "still open");
    assert.equal(zoneOf(engine, id("w")), "hand");
    answer(engine, P1, { kind: "resourceReveal", cardId: id("w"), selected: { t: [id("foe")] } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("w")), "play");
    assert.equal(zoneOf(engine, id("card1")), "play");
  });

  test("two revealable cards: after the first is deployed the offer is made again for the second", () => {
    const { engine, id } = revealBoard({
      greed: 4,
      extra: [{ key: "w2", def: revealer("Worm B"), owner: P1, zone: "hand" }] as never
    });
    activate(engine, P1, id("pl"), "go");
    answer(engine, P1, { kind: "chooserSelectsTarget", selected: [id("card1")] });
    assert.deepEqual((pend(engine)!.candidates as string[]).sort(), [id("w"), id("w2")].sort());
    answer(engine, P1, { kind: "resourceReveal", cardId: id("w") });
    const again = pend(engine)!;
    assert.equal(again.kind, "resourceReveal", "asked again");
    assert.deepEqual(again.candidates, [id("w2")]);
    answer(engine, P1, { kind: "resourceReveal" });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("w")), "play");
    assert.equal(zoneOf(engine, id("w2")), "hand");
    assert.equal(zoneOf(engine, id("card1")), "play");
  });

  test("'put a resource into play' is not playing one: no offer", () => {
    const putter = character({
      name: "Putter",
      behavior: {
        abilities: [
          {
            id: "go",
            type: "activated",
            effects: [
              {
                type: "chooserSelectsTarget",
                chooser: "controller",
                declaration: { id: "r", selector: { controller: "self", zone: "hand", type: "resource" }, count: 1 },
                effects: [{ type: "playResource", target: { type: "selected", id: "r" }, putIntoPlay: true }]
              }
            ]
          } as unknown as ActivatedAbility
        ]
      }
    });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "pl", def: putter, owner: P1, zone: "play" },
        { key: "w", def: revealer("Worm A"), owner: P1, zone: "hand" },
        { key: "res", def: resourceCard({ name: "Res" }), owner: P1, zone: "hand" },
        { key: "res2", def: resourceCard({ name: "Res2" }), owner: P1, zone: "hand" },
        ...bank("greed", 3, P1)
      ]
    });
    activate(engine, P1, id("pl"), "go");
    answer(engine, P1, { kind: "chooserSelectsTarget", selected: [id("res")] });
    assert.equal(pend(engine)?.kind, "playResource", "only the face-up / face-down question, no reveal offer");
    answer(engine, P1, { kind: "playResource", faceDown: false });
    assert.equal(pend(engine), undefined);
    assert.equal(zoneOf(engine, id("res")), "play");
    assert.equal(zoneOf(engine, id("w")), "hand");
  });
});

// ---------------------------------------------------------------------------
// duplicate
// ---------------------------------------------------------------------------

const copier = (): CardDefinition =>
  tactic({
    name: "Copier",
    cost: 0,
    behavior: { abilities: [{ id: "dup", type: "activated", effects: [{ type: "duplicate", target: { type: "lastDeployedTactic" } }] } as ActivatedAbility] }
  });

describe("W3a: duplicate re-asks picks and options", () => {
  test("a duplicated tactic asks its duplicator for its own play-time pick again", () => {
    const hurt = tactic({
      name: "Hurt",
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "h",
            type: "activated",
            targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
            effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }]
          } as unknown as ActivatedAbility
        ]
      }
    });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "hurt", def: hurt, owner: P1, zone: "hand" },
        { key: "cp", def: copier(), owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A", life: 9 }), owner: P2, zone: "play" },
        { key: "b", def: character({ name: "B", life: 9 }), owner: P2, zone: "play" }
      ]
    });
    play(engine, P1, id("hurt"), { selected: { t: [id("a")] } });
    assert.equal(engine.state.cards[id("a")].damage, 1);
    play(engine, P1, id("cp"));
    const ask = pend(engine)!;
    assert.equal(ask.kind, "chooserSelectsTarget");
    assert.equal(ask.playerId, P1);
    answer(engine, P1, { kind: "chooserSelectsTarget", selected: [id("b")] });
    assert.equal(engine.state.cards[id("b")].damage, 1, "the copy hit the character picked for it");
    assert.equal(engine.state.cards[id("a")].damage, 1, "the original pick is untouched");
  });

  test("a modal tactic's duplicate offers the labelled options and runs the chosen one with its own picks", () => {
    const modal = tactic({
      name: "Modal",
      cost: 0,
      behavior: {
        modes: [
          { label: "Draw", effects: [{ type: "draw", player: "controller", amount: 1 }] },
          {
            label: "Hurt",
            targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
            effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }]
          }
        ]
      } as never
    });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "modal", def: modal, owner: P1, zone: "hand" },
        { key: "cp", def: copier(), owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A", life: 9 }), owner: P2, zone: "play" },
        { key: "d", def: character({ name: "D" }), owner: P1, zone: "deck" }
      ]
    });
    play(engine, P1, id("modal"), { mode: 0 });
    play(engine, P1, id("cp"));
    const options = pend(engine)!;
    assert.equal(options.kind, "chooserSelectsOption");
    assert.deepEqual((options.options as Array<{ label: string }>).map(o => o.label), ["Draw", "Hurt"]);
    answer(engine, P1, { kind: "chooserSelectsOption", index: 1 });
    assert.equal(pend(engine)?.kind, "chooserSelectsTarget", "the chosen option's pick");
    answer(engine, P1, { kind: "chooserSelectsTarget", selected: [id("a")] });
    assert.equal(engine.state.cards[id("a")].damage, 2);
  });
});

// ---------------------------------------------------------------------------
// player-created faction ability
// ---------------------------------------------------------------------------

describe("W3a: a faction ability both players write (FactionDefinition.playerCreatedAbility)", () => {
  const rd = factionCard({
    id: "w3a-rd",
    name: "W3a R&D",
    faction: defaultFactionDefinition({
      playerCreatedAbility: true,
      setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 1, goingSecond: 1 } }
    })
  });
  const plain = factionCard({
    id: "w3a-plain",
    name: "W3a Plain",
    faction: defaultFactionDefinition({
      setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 1, goingSecond: 1 } }
    })
  });
  const filler = character({ id: "w3a-filler", name: "Filler" });
  // Lose 1 influence (always payable, so the ability is listed with no resources), then your faction gains 3: net +2.
  const created: CreatedAbilitySpec = {
    costs: [{ kind: "loseInfluence", amount: 1 }],
    effect: { kind: "gainInfluence", amount: 3 }
  };
  const createdText = "COST: Lose 1 influence. EFFECT: Your faction gains 3 influence.";

  const game = (withAbility: boolean) =>
    createTwoPlayerFactionGame(
      [rd, plain, filler],
      { id: P1, name: "A", deckDefinitionIds: [rd.id, ...Array(8).fill(filler.id)] },
      { id: P2, name: "B", deckDefinitionIds: [plain.id, ...Array(8).fill(filler.id)] },
      { seed: 3, ...(withAbility ? { createdAbility: created } : {}) }
    );

  test("setup gives the ability to the faction card that asks for it, and only that one", () => {
    const engine = game(true);
    const rdCard = engine.state.players[P1].factionId!;
    const plainCard = engine.state.players[P2].factionId!;
    assert.equal(engine.state.cards[rdCard].createdAbility?.text, createdText);
    assert.deepEqual(engine.state.cards[rdCard].createdAbility?.spec, created);
    assert.equal(engine.state.cards[rdCard].createdAbility?.ability.usableBy, "anyPlayer");
    assert.equal(engine.state.cards[plainCard].createdAbility, undefined);
    assert.equal(game(false).state.cards[rdCard].createdAbility, undefined, "no ability written: the card has none");
  });

  test("both players can use it once play begins; it resolves under whoever used it", () => {
    const engine = game(true);
    // Skip the opening mulligans.
    while (engine.state.setup.phase === "mulligan") {
      const setup = engine.state.setup as { order: string[]; currentIndex: number };
      engine.perform({ type: "mulligan", playerId: setup.order[setup.currentIndex], cardIds: [] } as never);
    }
    settleTurnStart(engine);
    const rdCard = engine.state.players[P1].factionId!;
    const active = engine.state.activePlayerId;
    const other = active === P1 ? P2 : P1;
    const usable = (p: string) => engine.getAvailableActivatedAbilities(p as never).filter(a => a.cardId === rdCard).map(a => a.ability.id);
    assert.deepEqual(usable(active), [CREATED_ABILITY_ID]);
    const before = engine.state.players[active].influence;
    activate(engine, active as never, rdCard, CREATED_ABILITY_ID);
    assert.equal(engine.state.players[active].influence, before + 2);
    // After the turn passes, the other player may use it too (it is not their card).
    engine.perform({ type: "endTurn", playerId: active } as never);
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    assert.deepEqual(usable(other), [CREATED_ABILITY_ID]);
  });
});

// ---------------------------------------------------------------------------
// "void the top card; if it is a tactic you may deploy it even if you cannot meet its threshold"
// ---------------------------------------------------------------------------

describe("W3a: voiding a card then deploying that very card (rememberTarget + deployFromZone)", () => {
  const top = { type: "deckPosition", player: "controller", from: "top", index: 0 } as const;
  const voidAndDeploy = (): CardDefinition =>
    character({
      name: "Voider",
      behavior: {
        abilities: [
          {
            id: "go",
            type: "activated",
            effects: [
              { type: "rememberTarget", key: "v", target: top },
              { type: "moveCard", target: top, to: "void" },
              {
                type: "if",
                condition: { type: "cardTypeIs", target: { type: "remembered", key: "v" }, cardType: "tactic" },
                effects: [
                  { type: "deployFromZone", player: "controller", target: { type: "remembered", key: "v" }, free: false, ignoreThreshold: true }
                ]
              }
            ]
          } as unknown as ActivatedAbility
        ]
      }
    });
  const zap = () =>
    tactic({
      name: "Zap",
      cost: 1,
      threshold: "g" as never,
      behavior: { abilities: [{ id: "z", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] } as ActivatedAbility] }
    });

  test("the remembered card is the one voided (not the next top card); it is deployed paying its cost but not meeting its threshold", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "v", def: voidAndDeploy(), owner: P1, zone: "play" },
        { key: "zap", def: zap(), owner: P1, zone: "deck" },
        { key: "next", def: character({ name: "Next" }), owner: P1, zone: "deck" },
        { key: "next2", def: character({ name: "Next2" }), owner: P1, zone: "deck" },
        ...bank("rage", 1, P1)
      ]
    });
    activate(engine, P1, id("v"), "go");
    assert.equal(zoneOf(engine, id("zap")), "void");
    assert.equal(pend(engine)?.kind, "deployForFree");
    answer(engine, P1, { kind: "deployForFree", cardId: id("zap") });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("zap")), "discard", "resolved");
    assert.equal(engine.getAvailableResourceCount(P1), 0, "its cost was paid");
    assert.equal(zoneOf(engine, id("next")), "hand", "the zap drew the next card");
  });

  test("a voided non-tactic offers nothing", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "v", def: voidAndDeploy(), owner: P1, zone: "play" },
        { key: "top", def: character({ name: "Top" }), owner: P1, zone: "deck" },
        { key: "zap", def: zap(), owner: P1, zone: "deck" },
        ...bank("rage", 1, P1)
      ]
    });
    activate(engine, P1, id("v"), "go");
    assert.equal(zoneOf(engine, id("top")), "void");
    assert.equal(pend(engine), undefined, "the tactic under it is NOT the voided card");
  });
});
