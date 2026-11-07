// Batch r14-showdown, part 5 (docs/TESTING.md): the Slightly Less Evil Alliance faction card, SD-SLE 1-SD-SLE 5
// (docs/rules/showdown-rules.md). Written from the printed wording, not from the engine. The rules suite uses
// synthetic factions only: `sharedFaction` (r14-showdown.shared.ts) is authored with the engine's Showdown
// vocabulary and stands in for the printed Slightly Less Evil Alliance.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { SpoilsEngine } from "../../../engine.js";
import { getLoyalty, opponentsOf, redactStateFor } from "../../../engine.js";
import { character, item, resolvePendingResponses, tactic } from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";
import {
  CHAMPION,
  exhaustHeroDeck,
  evilFaction,
  giveResources,
  influenceOf,
  passTurn,
  passTurnsTo,
  place,
  resourcesOf,
  table,
  use,
  zoneOf,
  type TableOptions
} from "./r14-showdown.shared.js";

const SERF = character({ name: "Serf", life: 3 });
const TRINKET = item({ name: "Trinket" });
const NOOP = item({
  name: "Noop",
  behavior: { abilities: [{ id: "noop", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
});
const PEP = tactic({
  name: "Pep",
  behavior: { abilities: [{ id: "pep", type: "activated", costs: [], effects: [{ type: "modifyInfluence", player: "controller", amount: 5 }] }] }
});
const OPERATOR = item({
  name: "Operator",
  behavior: { abilities: [{ id: "tempt", type: "activated", costs: [], effects: [{ type: "heroDeckToTemptationPile", count: 2 }] }] }
});

const LOYAL = ["heroes", "heroes", "heroes", "heroes"] as Array<"heroes" | "villain">;
const paid = (engine: SpoilsEngine, id: string) => resourcesOf(engine, id).filter(r => engine.state.cards[r].attachedTo !== undefined).length;

/** The status of `abilityId` on the shared faction, as `playerId` is offered it right now. */
const statusOf = (engine: SpoilsEngine, playerId: string, shared: string, abilityId: string) =>
  engine.getActivatedAbilityStatuses(playerId).find(status => status.cardId === shared && status.ability.id === abilityId);

/** Opens a response window in h1's turn in which `playerId` holds priority (h1 acts; everyone before them passes). */
function respondInH1Turn(engine: SpoilsEngine, playerId: string): void {
  engine.perform({ type: "activateAbility", playerId: "h1", cardId: place(engine, "h1", NOOP), abilityId: "noop" });
  for (let guard = 0; engine.state.responseWindow?.priorityPlayerId !== playerId; guard++) {
    assert.ok(guard < 6, `${playerId} gets priority`);
    engine.perform({ type: "passPriority", playerId: engine.state.responseWindow!.priorityPlayerId });
  }
}

describe("SD-SLE 1 - every Hero can use the abilities on this card", () => {
  rule("SD-SLE 1", "each Hero uses the card's abilities as themselves: SPRING FORTH in each Hero's own turn gives that Hero the card", () => {
    const { engine, shared } = table({ heroes: 3, heroDeck: [CHAMPION, CHAMPION, CHAMPION], allegiance: LOYAL });
    for (const hero of ["h1", "h2", "h3"]) {
      assert.equal(engine.state.activePlayerId, hero);
      const [top] = engine.state.showdown!.heroDeck;
      giveResources(engine, hero, 6);
      use(engine, hero, shared, "spring");
      assert.equal(engine.state.cards[top].controllerId, hero, `${hero} used it and the claim is theirs`);
      passTurn(engine);
    }
    assert.deepEqual(engine.state.showdown!.heroDeck, [], "three claims, one Hero Deck");
  });

  rule("SD-SLE 1", "the Villain is not a Hero: they cannot use the card, and are not even offered its abilities", () => {
    const { engine, shared } = table({ heroes: 2, first: "v", allegiance: LOYAL });
    giveResources(engine, "v", 6);
    refused(() => use(engine, "v", shared, "spring"), "the Villain using a Heroes-only ability", /Only a Hero/);
    assert.equal(engine.getActivatedAbilityStatuses("v").filter(status => status.cardId === shared).length, 0);
    assert.ok(engine.getActivatedAbilityStatuses("h1").some(status => status.cardId === shared), "control: Heroes are offered it");
  });

  rule("SD-SLE 1", "every one of its abilities is open to a Hero, not just one of them", () => {
    const { engine, shared } = table({ heroes: 2, allegiance: LOYAL });
    const offered = engine.getActivatedAbilityStatuses("h1").filter(status => status.cardId === shared).map(status => status.ability.id);
    assert.deepEqual(offered.sort(), ["give-in", "spring", "teamwork"]);
  });
});

describe("SD-SLE 2 - GIVE IN TO TEMPTATION", () => {
  /** h1 to move, h2 holds a Serf, the Temptation Pile holds two Hero cards. */
  const scene = (extra: { heroDeck?: TableOptions["heroDeck"] } = {}) => {
    const t = table({ heroes: 2, heroDeck: extra.heroDeck ?? [CHAMPION, TRINKET], deckExtras: [SERF, SERF, SERF, OPERATOR, NOOP], allegiance: LOYAL });
    use(t.engine, "h1", place(t.engine, "h1", OPERATOR), "tempt");
    const serf = place(t.engine, "h2", SERF);
    return { ...t, serf, pile: [...t.engine.state.showdown!.temptationPile] };
  };
  const giveIn = (t: ReturnType<typeof scene>, character: string, pileCard: string, hero = "h1") =>
    use(t.engine, hero, t.shared, "give-in", { c: [character], p: [pileCard] });

  rule("SD-SLE 2", "pay 2, pick another Hero's character: the Villain takes control of it", () => {
    const t = scene();
    giveResources(t.engine, "h1", 2);
    giveIn(t, t.serf, t.pile[0]);
    assert.equal(t.engine.state.cards[t.serf].controllerId, "v", "the Villain controls the Serf");
    assert.equal(t.engine.state.cards[t.serf].ownerId, "h2", "it is still h2's card");
    assert.ok(t.engine.state.players.v.play.includes(t.serf), "in the Villain's play area");
    assert.equal(paid(t.engine, "h1"), 2, "the cost was 2");
  });

  rule("SD-SLE 2", "and the Hero claims one card in the Temptation Pile, and only one", () => {
    const t = scene();
    giveResources(t.engine, "h1", 2);
    giveIn(t, t.serf, t.pile[1]);
    assert.equal(t.engine.state.cards[t.pile[1]].controllerId, "h1", "the picked pile card is claimed by the Hero who used it");
    assert.equal(zoneOf(t.engine, t.pile[1]), "play");
    assert.deepEqual(t.engine.state.showdown!.temptationPile, [t.pile[0]], "the other card is still in the pile");
  });

  rule("SD-SLE 2", "the claimed card is claimed under the Hero's control: a tactic from the pile is played free, ignoring threshold", () => {
    const t = scene({ heroDeck: [PEP, PEP] });
    giveResources(t.engine, "h1", 2);
    const before = influenceOf(t.engine, "h1");
    t.engine.perform({ type: "activateAbility", playerId: "h1", cardId: t.shared, abilityId: "give-in", selected: { c: [t.serf], p: [t.pile[0]] } });
    resolvePendingResponses(t.engine);
    assert.equal(t.engine.state.pendingChoice?.kind, "deployForFree");
    t.engine.perform({ type: "resolvePendingChoice", playerId: "h1", choice: { kind: "deployForFree", cardId: t.pile[0] } });
    resolvePendingResponses(t.engine);
    assert.equal(influenceOf(t.engine, "h1"), before + 5);
  });

  rule("SD-SLE 2", "the picked character must be another Hero's: your own character is refused", () => {
    const t = scene();
    const mine = place(t.engine, "h1", SERF);
    giveResources(t.engine, "h1", 2);
    refused(() => giveIn(t, mine, t.pile[0]), "picking a character the Hero controls themselves", /Illegal target/);
    assert.equal(t.engine.state.cards[mine].controllerId, "h1");
    giveIn(t, t.serf, t.pile[0]);
    assert.equal(t.engine.state.cards[t.serf].controllerId, "v", "control: another Hero's character is accepted");
  });

  rule("SD-SLE 2", "the Villain's own character is not 'another Hero's': it is refused", () => {
    const t = scene();
    const villains = place(t.engine, "v", SERF);
    giveResources(t.engine, "h1", 2);
    refused(() => giveIn(t, villains, t.pile[0]), "picking the Villain's character", /Illegal target/);
  });

  rule("SD-SLE 2", "it costs 2: with one resource it cannot be used, with exactly two it can", () => {
    const t = scene();
    giveResources(t.engine, "h1", 1);
    refused(() => giveIn(t, t.serf, t.pile[0]), "paying 2 with 1 resource", /cannot be paid/);
    assert.equal(t.engine.state.cards[t.serf].controllerId, "h2", "nothing happened");
    giveResources(t.engine, "h1", 2);
    giveIn(t, t.serf, t.pile[0]);
    assert.equal(t.engine.state.cards[t.serf].controllerId, "v");
  });

  rule("SD-SLE 2", "only during your turn: a Hero with priority in another Hero's turn is not offered it", () => {
    const t = scene();
    giveResources(t.engine, "h2", 2);
    const h1Serf = place(t.engine, "h1", SERF);
    respondInH1Turn(t.engine, "h2");
    assert.equal(t.engine.state.activePlayerId, "h1");
    const status = statusOf(t.engine, "h2", t.shared, "give-in");
    assert.equal(status?.available, false);
    assert.equal(status?.unavailableBecause, "condition");
    refused(
      () => t.engine.perform({ type: "activateAbility", playerId: "h2", cardId: t.shared, abilityId: "give-in", selected: { c: [h1Serf], p: [t.pile[0]] } }),
      "GIVE IN TO TEMPTATION in another Hero's turn",
      /condition is not satisfied/
    );
  });

  rule("SD-SLE 2", "once per turn: a second use in the same turn is refused, and a later turn allows it again", () => {
    const t = scene();
    const second = place(t.engine, "h2", SERF);
    giveResources(t.engine, "h1", 4);
    giveIn(t, t.serf, t.pile[0]);
    refused(() => giveIn(t, second, t.pile[1]), "a second GIVE IN TO TEMPTATION this turn", /only 1 time/);
    passTurn(t.engine);
    passTurn(t.engine);
    passTurn(t.engine);
    assert.equal(t.engine.state.activePlayerId, "h1");
    giveResources(t.engine, "h1", 2);
    giveIn(t, second, t.pile[1]);
    assert.equal(t.engine.state.cards[second].controllerId, "v", "control: the next turn it works");
  });
});

describe("SD-SLE 3 - SPRING FORTH MY BURLY PROTECTOR!", () => {
  const spring = (heroDeck: TableOptions["heroDeck"] = [CHAMPION, TRINKET]) =>
    table({ heroes: 2, heroDeck, allegiance: LOYAL });

  rule("SD-SLE 3", "pay 6: the top card of the Hero Deck is revealed and claimed", () => {
    const { engine, shared } = spring();
    const [top, second] = engine.state.showdown!.heroDeck;
    giveResources(engine, "h1", 6);
    use(engine, "h1", shared, "spring");
    assert.equal(engine.state.cards[top].controllerId, "h1", "claimed by the Hero who used it");
    assert.equal(zoneOf(engine, top), "play");
    assert.deepEqual(engine.state.showdown!.heroDeck, [second], "only the top card was taken");
    assert.equal(paid(engine, "h1"), 6, "the cost was 6");
    const revealed = engine.getLog().some(entry => entry.event?.type === "cardsRevealed" && entry.event.cardIds.includes(top));
    assert.equal(revealed, true, "the card was revealed on its way");
  });

  rule("SD-SLE 3", "it costs 6: with 5 resources it cannot be used, with exactly 6 it can", () => {
    const { engine, shared } = spring();
    const heroDeck = [...engine.state.showdown!.heroDeck];
    giveResources(engine, "h1", 5);
    refused(() => use(engine, "h1", shared, "spring"), "paying 6 with 5 resources", /cannot be paid/);
    assert.deepEqual(engine.state.showdown!.heroDeck, heroDeck, "nothing was claimed");
    giveResources(engine, "h1", 6);
    use(engine, "h1", shared, "spring");
    assert.equal(engine.state.showdown!.heroDeck.length, 1, "control: with 6 it works");
  });

  rule("SD-SLE 3", "a revealed tactic is claimed like any Hero card: played free, ignoring threshold, then removed", () => {
    const { engine, shared } = spring([PEP]);
    const [top] = engine.state.showdown!.heroDeck;
    giveResources(engine, "h1", 6);
    const before = influenceOf(engine, "h1");
    engine.perform({ type: "activateAbility", playerId: "h1", cardId: shared, abilityId: "spring" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "deployForFree");
    engine.perform({ type: "resolvePendingChoice", playerId: "h1", choice: { kind: "deployForFree", cardId: top } });
    resolvePendingResponses(engine);
    assert.equal(influenceOf(engine, "h1"), before + 5);
    assert.equal(zoneOf(engine, top), "removed");
  });

  rule("SD-SLE 3", "with the Hero Deck empty there is nothing to reveal or claim", () => {
    const { engine, shared } = spring();
    exhaustHeroDeck(engine);
    giveResources(engine, "h1", 6);
    const playBefore = [...engine.state.players.h1.play];
    use(engine, "h1", shared, "spring");
    assert.deepEqual(engine.state.players.h1.play.filter(id => !playBefore.includes(id)), [], "no new card");
  });
});

describe("SD-SLE 4 - TEAMWORK", () => {
  const scene = () => {
    const t = table({ heroes: 2, deckExtras: [SERF, SERF, TRINKET, NOOP], allegiance: LOYAL });
    return { ...t, mine: place(t.engine, "h1", SERF) };
  };
  const factionOf = (e: SpoilsEngine, id: string) => e.state.players[id].factionId!;
  const teamwork = (t: ReturnType<typeof scene>, card: string, who: string) =>
    use(t.engine, "h1", t.shared, "teamwork", { mine: [card], who: [factionOf(t.engine, who)] });

  rule("SD-SLE 4", "pay 2, pick a card you control, choose another player: that player takes control of the card", () => {
    const t = scene();
    giveResources(t.engine, "h1", 2);
    teamwork(t, t.mine, "h2");
    assert.equal(t.engine.state.cards[t.mine].controllerId, "h2", "h2 now controls it");
    assert.ok(t.engine.state.players.h2.play.includes(t.mine), "it is among h2's cards in play");
    assert.ok(!t.engine.state.players.h1.play.includes(t.mine), "and h1 no longer does");
    assert.equal(t.engine.state.cards[t.mine].ownerId, "h1", "it is still h1's card");
    assert.equal(paid(t.engine, "h1"), 2, "the cost was 2");
  });

  rule("SD-SLE 4", "the other player can be the Villain: any other player may be chosen", () => {
    const t = scene();
    giveResources(t.engine, "h1", 2);
    teamwork(t, t.mine, "v");
    assert.equal(t.engine.state.cards[t.mine].controllerId, "v");
  });

  rule("SD-SLE 4", "any card you control can be picked, not just a character: an item can be given", () => {
    const t = scene();
    const trinket = place(t.engine, "h1", TRINKET);
    giveResources(t.engine, "h1", 2);
    teamwork(t, trinket, "h2");
    assert.equal(t.engine.state.cards[trinket].controllerId, "h2");
  });

  rule("SD-SLE 4", "you cannot choose yourself as the other player", () => {
    const t = scene();
    giveResources(t.engine, "h1", 2);
    refused(() => teamwork(t, t.mine, "h1"), "choosing yourself", /Illegal target/);
    assert.equal(t.engine.state.cards[t.mine].controllerId, "h1");
    teamwork(t, t.mine, "h2");
    assert.equal(t.engine.state.cards[t.mine].controllerId, "h2", "control: another player is accepted");
  });

  rule("SD-SLE 4", "the card picked must be one you control: another Hero's card is refused", () => {
    const t = scene();
    const theirs = place(t.engine, "h2", SERF);
    giveResources(t.engine, "h1", 2);
    refused(() => teamwork(t, theirs, "v"), "picking a card another Hero controls", /Illegal target/);
    assert.equal(t.engine.state.cards[theirs].controllerId, "h2");
  });

  rule("SD-SLE 4", "it costs 2: with one resource it cannot be used", () => {
    const t = scene();
    giveResources(t.engine, "h1", 1);
    refused(() => teamwork(t, t.mine, "h2"), "paying 2 with 1 resource", /cannot be paid/);
    assert.equal(t.engine.state.cards[t.mine].controllerId, "h1");
  });

  rule("SD-SLE 4", "unlike GIVE IN TO TEMPTATION it has no 'only during your turn': a Hero may use it in another Hero's turn", () => {
    const t = scene();
    giveResources(t.engine, "h2", 2);
    respondInH1Turn(t.engine, "h2");
    assert.equal(t.engine.state.activePlayerId, "h1");
    assert.equal(statusOf(t.engine, "h2", t.shared, "teamwork")?.available, true);
    assert.equal(statusOf(t.engine, "h2", t.shared, "give-in")?.available, false, "while GIVE IN TO TEMPTATION is not");
  });

  rule("SD-SLE 4", "it can be used again and again: no once-per-turn limit", () => {
    const t = scene();
    const trinket = place(t.engine, "h1", TRINKET);
    giveResources(t.engine, "h1", 4);
    teamwork(t, t.mine, "h2");
    teamwork(t, trinket, "v");
    assert.deepEqual([t.engine.state.cards[t.mine].controllerId, t.engine.state.cards[trinket].controllerId], ["h2", "v"]);
  });
});

describe("SD-SLE 5 - YOUR TRUE COLORS ARE REVEALED", () => {
  const tokens = (engine: SpoilsEngine, shared: string) => engine.state.cards[shared].counters.token ?? 0;
  const faceUp = (engine: SpoilsEngine) => Object.values(engine.state.showdown!.allegiance).map(card => card.faceUp);

  rule("SD-SLE 5", "at the start of the Villain's turn a token goes on this card, and not at a Hero's turn start", () => {
    const { engine, shared } = table({ heroes: 2, first: "h1", allegiance: LOYAL, villainFaction: evilFaction() });
    const seen: Array<[string, number]> = [];
    for (let i = 0; i < 6; i++) {
      seen.push([engine.state.activePlayerId, tokens(engine, shared)]);
      passTurn(engine);
    }
    assert.deepEqual(seen, [["h1", 0], ["h2", 0], ["v", 1], ["h1", 1], ["h2", 1], ["v", 2]], "tokens only grow when the Villain's turn starts");
  });

  rule("SD-SLE 5", "6 tokens reveal nothing: every Allegiance card is still face-down", () => {
    const { engine, shared } = table({ heroes: 3, first: "h1", allegiance: LOYAL });
    engine.state.cards[shared].counters.token = 5;
    passTurnsTo(engine, "v");
    assert.equal(tokens(engine, shared), 6);
    assert.deepEqual(faceUp(engine), [false, false, false]);
  });

  rule("SD-SLE 5", "at 7 tokens all Heroes turn their Allegiance cards face-up", () => {
    const { engine, shared } = table({ heroes: 3, first: "h1", allegiance: ["villain", "heroes", "heroes", "heroes"] });
    engine.state.cards[shared].counters.token = 6;
    passTurnsTo(engine, "v");
    assert.equal(tokens(engine, shared), 7);
    assert.deepEqual(faceUp(engine), [true, true, true], "every Hero's card is face-up, whichever side it shows");
    const spectator = redactStateFor(engine.state, "spectator").showdown!.allegiance;
    for (const id of ["h1", "h2", "h3"]) assert.notEqual(spectator[id].loyalty, "hidden", `${id}'s card is public now`);
  });

  rule("SD-SLE 5", "it takes seven Villain turns from scratch: nothing is revealed before the 7th, everything at the 7th", () => {
    const { engine, shared } = table({ heroes: 2, first: "v", allegiance: ["villain", "villain", "villain"] });
    const startOfVillainTurn = () => engine.state.activePlayerId === "v";
    assert.ok(startOfVillainTurn(), "the Villain opens the game");
    const revealedAt: number[] = [];
    for (let turns = 1; turns <= 7; turns++) {
      if (faceUp(engine).every(Boolean)) revealedAt.push(tokens(engine, shared));
      if (turns < 7) {
        passTurn(engine);
        passTurn(engine);
        passTurn(engine);
        assert.ok(startOfVillainTurn(), "back to the Villain");
      }
    }
    assert.ok(tokens(engine, shared) >= 7 || revealedAt.length > 0, "seven Villain turns put seven tokens on the card");
    assert.deepEqual(faceUp(engine), [true, true], "the cards are face-up after the seventh");
    assert.deepEqual(revealedAt.filter(count => count < 7), [], "never earlier than 7 tokens");
  });

  rule("SD-SLE 5", "once the cards are face-up, a Villain-loyal Hero's opponent is another Hero (SD 15 applies)", () => {
    const { engine, shared } = table({ heroes: 2, first: "h1", allegiance: ["villain", "villain", "villain"] });
    assert.deepEqual(opponentsOf(engine.state, "h1"), ["v"], "face-down: the Villain");
    engine.state.cards[shared].counters.token = 6;
    passTurnsTo(engine, "v");
    assert.equal(getLoyalty(engine.state, "h1"), "villain");
    assert.deepEqual(opponentsOf(engine.state, "h1"), ["h2"], "face-up: the other Hero");
  });
});
