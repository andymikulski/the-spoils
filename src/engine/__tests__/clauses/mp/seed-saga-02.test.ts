// Multiplayer clause tests, seed-saga part 2: 3- and 4-seat tables, real catalog printings, public actions only.
// Spec: data/card-tests/mp-spec/seed-saga.json.
import assert from "node:assert/strict";
import { clause, clauseMismatch, refused } from "../_clause.js";
import { activate, answer, askedPlayers, choosePlayer, deck, hand, many, pending, play, printing, requirements, res, ready, seatsOf, table, zoneOf, P1, P2, P3, P4 } from "./_mp.js";
import type { PendingChoiceLike, Table } from "./_mp.js";
import { endTurn } from "../_turn.js";
import { declareAttackBy } from "../_battle.js";
import { buildGame, character, defaultFactionDefinition, factionCard, item, resolvePendingResponses, resourceCard } from "../../support/fixtures.js";
import type { CardPlacement } from "../../support/fixtures.js";
import type { PlayerId } from "../../../../engine.js";

const seats = (count: number): PlayerId[] => (count === 3 ? [P1, P2, P3] : [P1, P2, P3, P4]);
const others = (count: number): PlayerId[] => seats(count).slice(1);
const last = (count: number): PlayerId => seats(count)[count - 1]!;

/** `n` cards in `zone` for each of `who`, keyed `<prefix>-<seat>-<i>`. */
const pad = (prefix: string, who: PlayerId[], n: number, zone: "hand" | "deck" | "discard") =>
  who.flatMap((p) => many(`${prefix}-${p}-`, n, p, zone, (i) => character({ name: `${prefix} ${p} ${i}` })));

/** The cards the open pick may take (the engine's own candidate list for the open declaration). */
const candidates = (t: Table, pc: PendingChoiceLike): string[] =>
  (t.engine as unknown as { targetCandidates(selector: unknown, context: unknown, pickerId: string): Array<{ id: string }> })
    .targetCandidates((pc.declaration as { selector: unknown }).selector, pc.context, pc.playerId)
    .map((c) => c.id);

/** The default answer to a pick: nothing when it is optional, else the first cards the engine offers. */
const required = (t: Table, pc: PendingChoiceLike): string[] => {
  const d = pc.declaration as { optional?: boolean; count?: number };
  return d.optional ? [] : candidates(t, pc).slice(0, typeof d.count === "number" ? d.count : 1);
};

/** Answers whatever is pending: `pick(pc)` returns a choice or undefined for "decline". Records every prompt seen. */
function run(t: Table, pick: (pc: PendingChoiceLike) => Record<string, unknown> | undefined = () => undefined): PendingChoiceLike[] {
  const seen: PendingChoiceLike[] = [];
  for (let i = 0; i < 20; i++) {
    const pc = pending(t.engine);
    if (!pc) return seen;
    seen.push({ ...pc });
    let choice = pick(pc);
    if (!choice) {
      choice =
        pc.kind === "chooserSelectsOption"
          ? { kind: pc.kind, index: 0 }
          : pc.kind === "chooserSelectsTarget"
            ? { kind: pc.kind, selected: required(t, pc) }
            : pc.kind === "orderTriggers"
              ? { kind: pc.kind, next: (pc.triggers as unknown[])[0] }
              : pc.kind === "choosePlayer"
                ? { kind: pc.kind, playerId: (pc.candidates as PlayerId[])[0] }
                : { kind: pc.kind };
    }
    t.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
    // let any response window pass
    for (let g = 0; g < 50 && t.engine.state.responseWindow && !t.engine.state.pendingChoice; g++) {
      const w = t.engine.state.responseWindow;
      t.engine.perform((w.phase === "acceptingResponses" ? { type: "passPriority", playerId: w.priorityPlayerId } : { type: "advanceFlow" }) as never);
    }
  }
  throw new Error("prompts did not settle");
}
const kinds = (seen: PendingChoiceLike[]): string[] => seen.map((pc) => pc.kind);

// =========================================================================================
// CRYPTIC ATHENAEUM (Seed Saga)
// =========================================================================================

const CA = "746d863d-9b90-4cca-8896-a111523d4f7a";

/** P1 controls the Athenaeum with `obs` obsession resources; the last seat is active, so `endTurn` starts P1's turn. */
const athenaeum = (count: number, obs: number) =>
  table(
    count,
    [
      { key: "ca", def: printing(CA), owner: P1, zone: "play" },
      ...res("obsession", obs, P1),
      ...pad("h", seats(count), 3, "hand"),
      ...pad("d", seats(count), 4, "deck"),
      { key: "c1", def: character({ name: "P1 char" }), owner: P1, zone: "play" },
      { key: "c2", def: character({ name: "P2 char" }), owner: P2, zone: "play" },
      { key: "c3", def: character({ name: "P3 char" }), owner: P3, zone: "play" }
    ],
    last(count)
  );

for (const count of [3, 4] as const) {
  clause(CA, "1:rule@ooo", `${count} seats: drawing makes P1 choose one opponent; only that opponent is offered the optional draw`, () => {
    for (const chosen of others(count)) {
      for (const accept of [true, false]) {
        const t = athenaeum(count, 3);
        endTurn(t.engine, last(count));
        assert.equal(t.engine.state.activePlayerId, P1);
        const seen = run(t, (pc) => {
          if (pc.kind === "chooserSelectsOption" && pc.playerId === P1) return { kind: pc.kind, index: 1 };
          if (pc.kind === "choosePlayer") return { kind: pc.kind, playerId: chosen };
          if (pc.kind === "chooserSelectsOption") return { kind: pc.kind, index: accept ? 1 : 0 };
          return undefined;
        });
        const chooses = seen.filter((pc) => pc.kind === "choosePlayer");
        assert.equal(chooses.length, 1, "exactly one opponent is chosen");
        assert.equal(chooses[0]!.playerId, P1, "the controller chooses");
        assert.deepEqual([...(chooses[0]!.candidates as PlayerId[])].sort(), others(count), "P1 is never offered");
        const offers = seen.filter((pc) => pc.kind === "chooserSelectsOption" && pc.playerId !== P1);
        assert.equal(offers.length, 1, "one opponent is offered the draw");
        assert.equal(offers[0]!.playerId, chosen);
        assert.equal(hand(t.engine, P1).length, 4, "P1 drew");
        for (const p of others(count)) assert.equal(hand(t.engine, p).length, p === chosen && accept ? 4 : 3, `${p}`);
      }
    }
  });

  clause(CA, "1:rule@ooo", `${count} seats: if P1 declines the draw no opponent is offered one`, () => {
    const t = athenaeum(count, 3);
    endTurn(t.engine, last(count));
    const seen = run(t);
    assert.ok(!seen.some((pc) => pc.kind === "chooserSelectsOption" && pc.playerId !== P1), `no opponent offered the draw: ${kinds(seen)}`);
    for (const p of seats(count)) assert.equal(hand(t.engine, p).length, 3, `${p} drew nothing`);
  });

  clause(CA, "2:rule@ooooo", `${count} seats: one opponent chosen by P1; only that opponent discards a card of their choice`, () => {
    for (const chosen of others(count)) {
      const t = athenaeum(count, 5);
      endTurn(t.engine, last(count));
      const seen = run(t, (pc) => {
        if (pc.kind === "choosePlayer" && pc.abilityId === "t5") return { kind: pc.kind, playerId: chosen };
        if (pc.kind === "chooserSelectsTarget" && pc.playerId === chosen) return { kind: pc.kind, selected: [hand(t.engine, chosen)[1]!] };
        return undefined;
      });
      const chooses = seen.filter((pc) => pc.kind === "choosePlayer" && pc.abilityId === "t5");
      assert.equal(chooses.length, 1, "exactly one opponent is chosen for the discard");
      assert.deepEqual([...(chooses[0]!.candidates as PlayerId[])].sort(), others(count));
      const picks = seen.filter((pc) => pc.kind === "chooserSelectsTarget");
      assert.equal(picks.length, 1);
      assert.equal(picks[0]!.playerId, chosen, "the chosen opponent picks the discard");
      for (const p of others(count)) assert.equal(hand(t.engine, p).length, p === chosen ? 2 : 3, `${p}`);
      assert.equal(hand(t.engine, P1).length, 3);
    }
  });

  clause(CA, "3:rule@ooooooo", `${count} seats: bouncing any player's character goes to its owner's hand; no opponent is asked`, () => {
    for (const [who, key] of [[P3, "c3"], [P2, "c2"]] as const) {
      const t = athenaeum(count, 7);
      endTurn(t.engine, last(count));
      const seen = run(t, (pc) => {
        if (pc.kind === "chooserSelectsTarget" && pc.playerId === P1) return { kind: pc.kind, selected: [t.id(key)] };
        return undefined;
      });
      assert.ok(!seen.some((pc) => pc.kind === "choosePlayer" && pc.abilityId === "t7"), "no opponent is asked for this sentence");
      assert.equal(zoneOf(t.engine, t.id(key)), "hand");
      assert.ok(hand(t.engine, who).includes(t.id(key)), "to its owner's hand");
      assert.equal(zoneOf(t.engine, t.id("c1")), "play");
    }
  });
}

// =========================================================================================
// A DEATH FIT FOR A KING
// =========================================================================================

const DF = "605554df-72a7-4b72-91cc-f6983165d620";

const deathFit = (count: number) =>
  table(count, [
    { key: "df", def: printing(DF), owner: P1, zone: "hand" },
    ...res("obsession", 2, P1),
    { key: "A", def: character({ name: "Plain A" }), owner: P2, zone: "discard" },
    { key: "B", def: character({ name: "Plain B" }), owner: P3, zone: "discard" },
    { key: "C", def: character({ name: "Plain C" }), owner: P1, zone: "discard" },
    ...(count === 4 ? [{ key: "D", def: character({ name: "Plain D" }), owner: P4, zone: "discard" as const }] : [])
  ]);

for (const count of [3, 4] as const) {
  const victims = count === 3 ? ["A", "B"] : ["A", "B", "D"];
  clause(DF, "0:extraCost", `${count} seats: a non-UNIQUE character in ANY opponent's discard pile can be picked, my own cannot; no opponent is chosen`, () => {
    const probe = deathFit(count);
    assert.equal(askedPlayers(probe.engine, { type: "playCard", playerId: P1, cardId: probe.id("df"), selected: {}, variables: {} }), undefined, "no opponent step");
    for (const key of victims) {
      const t = deathFit(count);
      play(t.engine, P1, t.id("df"), { selected: { victim: [t.id(key)] } });
      assert.equal(pending(t.engine), undefined, "no prompt follows");
      assert.equal(zoneOf(t.engine, t.id(key)), "void");
      assert.equal(zoneOf(t.engine, t.id("df")), "discard");
      for (const other of victims.filter((k) => k !== key)) assert.equal(zoneOf(t.engine, t.id(other)), "discard", `${other} stays in its owner's discard pile`);
      assert.equal(zoneOf(t.engine, t.id("C")), "discard");
    }
    const t = deathFit(count);
    refused(() => play(t.engine, P1, t.id("df"), { selected: { victim: [t.id("C")] } }), "my own non-UNIQUE discard card");
    assert.equal(zoneOf(t.engine, t.id("C")), "discard");
    assert.equal(zoneOf(t.engine, t.id("df")), "hand");
  });

  clause(DF, "1:rule", `${count} seats: the picked character goes into the void; the other opponents' discard piles and the void are otherwise unchanged`, () => {
    const t = deathFit(count);
    play(t.engine, P1, t.id("df"), { selected: { victim: [t.id("B")] } });
    assert.equal(zoneOf(t.engine, t.id("B")), "void");
    assert.deepEqual([...t.engine.state.players[P3]!.discard], []);
    assert.deepEqual([...t.engine.state.players[P2]!.discard], [t.id("A")]);
    const inVoid = Object.values(t.engine.state.cards).filter((c) => c.zone === "void");
    assert.equal(inVoid.length, 1);
  });
}

// =========================================================================================
// ARCANE MONKEY RITUAL
// =========================================================================================

const ARM = "0f2882a3-7f34-43ff-9547-0c05b40c365d";

const ritual = (count: number) =>
  table(count, [
    { key: "arm", def: printing(ARM), owner: P1, zone: "discard" },
    ...res("obsession", 4, P1),
    ...pad("h", seats(count), 4, "hand")
  ]);

for (const count of [3, 4] as const) {
  clause(ARM, "1:ability:recur", `${count} seats: RECUR with any one faction picked; that faction's player (and only that player) chooses and discards 2 of their own cards`, () => {
    for (const who of seats(count)) {
      const t = ritual(count);
      const action = { type: "activateAbility", playerId: P1, cardId: t.id("arm"), abilityId: "recur", selected: {}, variables: {} };
      const need = requirements(t.engine, action).find((r) => r.kind === "pick");
      assert.ok(need, "the faction pick is asked");
      assert.deepEqual([...(need!.candidates as string[])].sort(), seats(count).map((p) => t.engine.state.players[p]!.factionId!).sort(), "every faction is offered");
      activate(t.engine, P1, t.id("arm"), "recur", { selected: { player: [t.engine.state.players[who]!.factionId!] } });
      assert.equal(zoneOf(t.engine, t.id("arm")), "removed");
      assert.equal(ready(t.engine, P1), 0, "COST: 4 paid");
      const pc = pending(t.engine)!;
      assert.equal(pc.kind, "chooserSelectsTarget");
      assert.equal(pc.playerId, who, "the picked faction's player chooses");
      const stranger = seats(count).find((p) => p !== who)!;
      refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [hand(t.engine, stranger)[0]!, hand(t.engine, who)[0]!] }), "a card from another player's hand");
      const mine = hand(t.engine, who);
      answer(t.engine, "chooserSelectsTarget", { selected: [mine[1]!, mine[3]!] });
      assert.equal(zoneOf(t.engine, mine[1]!), "discard");
      assert.equal(zoneOf(t.engine, mine[3]!), "discard");
      for (const p of seats(count)) assert.equal(hand(t.engine, p).length, p === who ? 2 : 4, `${p}`);
    }
  });
}

// A character, an item and a resource card in the hand of every opponent (keys `ch-`, `it-`, `rs-` + seat).
const oppHands = (count: number): CardPlacement[] =>
  others(count).flatMap((p): CardPlacement[] => [
    { key: `ch-${p}`, def: character({ name: `${p} char` }), owner: p, zone: "hand" },
    { key: `it-${p}`, def: item({ name: `${p} item` }), owner: p, zone: "hand" },
    { key: `rs-${p}`, def: resourceCard({ name: `${p} res` }), owner: p, zone: "hand" }
  ]);

const cardOf = (t: Table, id: string) => t.engine.state.cards[id]!;

// =========================================================================================
// DAY OF THE TENTACLE
// =========================================================================================

const DT = "d5690716-c88f-4297-8a2a-54392c6ac1b5";

const tentacle = (count: number) =>
  table(count, [{ key: "dt", def: printing(DT), owner: P1, zone: "hand" }, ...res("obsession", 1, P1), ...oppHands(count)]);

for (const count of [3, 4] as const) {
  clause(DT, "0:rule", `${count} seats: P1 names one opponent; only that hand is looked at and the card enters play under THAT opponent's control face-down as a resource`, () => {
    for (const chosen of others(count)) {
      const t = tentacle(count);
      const action = { type: "playCard", playerId: P1, cardId: t.id("dt"), selected: {}, variables: {} };
      assert.deepEqual(askedPlayers(t.engine, action), [{ id: "opp", candidates: others(count) }]);
      refused(() => play(t.engine, P1, t.id("dt")), "no opponent named");
      play(t.engine, P1, t.id("dt"), { players: { opp: chosen } });
      const pc = pending(t.engine)!;
      assert.equal(pc.kind, "chooserSelectsTarget");
      assert.equal(pc.playerId, P1);
      assert.deepEqual(candidates(t, pc), [t.id(`ch-${chosen}`), t.id(`it-${chosen}`)], "only the named opponent's non-resource cards");
      const stranger = others(count).find((p) => p !== chosen)!;
      refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`ch-${stranger}`)] }), "another opponent's card");
      refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`rs-${chosen}`)] }), "a resource card");
      answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`ch-${chosen}`)] });
      const card = cardOf(t, t.id(`ch-${chosen}`));
      assert.equal(card.zone, "play");
      assert.equal(card.controllerId, chosen, "under the named opponent's control");
      assert.equal(card.ownerId, chosen);
      assert.equal(card.faceDown, true, "face-down resource");
      for (const p of others(count).filter((o) => o !== chosen)) {
        assert.equal(hand(t.engine, p).length, 3, `${p}'s hand unchanged`);
        assert.equal(t.engine.state.players[p]!.play.length, 1, `${p} gains no resource (only the faction)`);
      }
    }
  });
}

// =========================================================================================
// DEATH OF THE DEMON KNIGHTS
// =========================================================================================

const DDK = "053823cb-77ae-494e-83a1-b19084e9038d";

const demonKnights = (count: number) =>
  table(count, [
    { key: "ddk", def: printing(DDK), owner: P1, zone: "hand" },
    ...res("obsession", 7, P1),
    ...pad("pd", [P1], 3, "deck"),
    ...others(count).flatMap((p): CardPlacement[] => [
      { key: `a-${p}`, def: character({ name: `${p} A` }), owner: p, zone: "play" },
      { key: `b-${p}`, def: character({ name: `${p} B` }), owner: p, zone: "play" },
      ...many(`dk-${p}-`, 2, p, "deck", (i) => character({ name: `${p} deck ${i}` }))
    ])
  ]);

for (const count of [3, 4] as const) {
  for (const pay of [true, false]) {
    clause(DDK, "0:extraCost", `${count} seats: ${pay ? "paying 2 makes the picked character's controller (not another opponent) pick another of THEIR characters" : "not paying puts only the picked character on the bottom of its owner's deck"}`, () => {
      for (const owner of others(count)) {
        const t = demonKnights(count);
        play(t.engine, P1, t.id("ddk"), { selected: { mark: [t.id(`a-${owner}`)] } });
        const may = pending(t.engine)!;
        assert.equal(may.kind, "mayPay");
        assert.equal(may.playerId, P1);
        const before = hand(t.engine, P1).length;
        if (pay) {
          answer(t.engine, "mayPay", { pay: true });
          const pc = pending(t.engine)!;
          assert.equal(pc.kind, "chooserSelectsTarget");
          assert.equal(pc.playerId, owner, "the controller of the picked character picks");
          assert.deepEqual(candidates(t, pc), [t.id(`b-${owner}`)], "only another character that player controls: the picked one is excluded, other opponents' characters are not offered");
          const stranger = others(count).find((p) => p !== owner)!;
          refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`b-${stranger}`)] }), "another opponent's character");
          answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`b-${owner}`)] });
          assert.deepEqual(deck(t.engine, owner).slice(-2).sort(), [t.id(`a-${owner}`), t.id(`b-${owner}`)].sort(), "both on the bottom of that player's deck");
          assert.equal(zoneOf(t.engine, t.id(`b-${owner}`)), "deck");
        } else {
          answer(t.engine, "mayPay", { pay: false });
          assert.equal(pending(t.engine), undefined);
          assert.equal(zoneOf(t.engine, t.id(`b-${owner}`)), "play", "the second character stays");
          assert.equal(deck(t.engine, owner)[deck(t.engine, owner).length - 1], t.id(`a-${owner}`));
        }
        assert.equal(zoneOf(t.engine, t.id(`a-${owner}`)), "deck");
        assert.equal(hand(t.engine, P1).length, before + 1, "P1 draws a card");
        for (const p of others(count).filter((o) => o !== owner)) {
          assert.equal(zoneOf(t.engine, t.id(`a-${p}`)), "play", `${p}'s characters untouched`);
          assert.equal(zoneOf(t.engine, t.id(`b-${p}`)), "play");
        }
      }
    });
  }

  clause(DDK, "1:rule", `${count} seats: the picked and the second character each go on the bottom of their own owner's deck and P1 draws`, () => {
    for (const owner of others(count)) {
      const t = demonKnights(count);
      play(t.engine, P1, t.id("ddk"), { selected: { mark: [t.id(`b-${owner}`)] } });
      answer(t.engine, "mayPay", { pay: true });
      answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`a-${owner}`)] });
      assert.deepEqual(deck(t.engine, owner).slice(-2).sort(), [t.id(`a-${owner}`), t.id(`b-${owner}`)].sort());
      assert.equal(hand(t.engine, P1).length, 1);
      for (const p of others(count).filter((o) => o !== owner)) assert.equal(deck(t.engine, p).length, 2, `${p}'s deck unchanged`);
    }
  });
}

// =========================================================================================
// DEFILER OF INNOCENCE
// =========================================================================================

const DI = "48097f03-931c-4241-bfed-2ccd8e731546";

const defiler = (count: number) =>
  table(count, [{ key: "di", def: printing(DI), owner: P1, zone: "play" }, ...res("obsession", 4, P1), ...oppHands(count)]);

for (const count of [3, 4] as const) {
  clause(DI, "1:ability:defile", `${count} seats: P1 names one opponent; only that hand is looked at and only a character in it can be discarded`, () => {
    for (const chosen of others(count)) {
      const t = defiler(count);
      const action = { type: "activateAbility", playerId: P1, cardId: t.id("di"), abilityId: "defile", selected: {}, variables: {} };
      assert.deepEqual(askedPlayers(t.engine, action), [{ id: "opp", candidates: others(count) }]);
      refused(() => activate(t.engine, P1, t.id("di"), "defile"), "no opponent named");
      activate(t.engine, P1, t.id("di"), "defile", { players: { opp: chosen } });
      assert.equal(cardOf(t, t.id("di")).depleted, true, "COST: deplete this card");
      const pc = pending(t.engine)!;
      assert.equal(pc.kind, "chooserSelectsTarget");
      assert.equal(pc.playerId, P1);
      assert.deepEqual(candidates(t, pc), [t.id(`ch-${chosen}`)], "only a character in the named opponent's hand");
      const stranger = others(count).find((p) => p !== chosen)!;
      refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`ch-${stranger}`)] }), "another opponent's character");
      refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`it-${chosen}`)] }), "a non-character");
      answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`ch-${chosen}`)] });
      assert.equal(zoneOf(t.engine, t.id(`ch-${chosen}`)), "discard");
      assert.equal(hand(t.engine, chosen).length, 2);
      for (const p of others(count).filter((o) => o !== chosen)) assert.equal(hand(t.engine, p).length, 3, `${p}'s hand unchanged`);
    }
  });
}

// =========================================================================================
// ENCUMBER
// =========================================================================================

const EN = "55946c3c-d213-4948-9656-53bb189e4d49";

const encumber = (count: number) =>
  table(count, [{ key: "en", def: printing(EN), owner: P1, zone: "discard" }, ...res("obsession", 2, P1), ...oppHands(count)]);

for (const count of [3, 4] as const) {
  clause(EN, "2:ability:recur", `${count} seats: RECUR names one opponent; only that hand is looked at and a non-resource card in it is discarded`, () => {
    for (const chosen of others(count)) {
      const t = encumber(count);
      const action = { type: "activateAbility", playerId: P1, cardId: t.id("en"), abilityId: "recur", selected: {}, variables: {} };
      assert.deepEqual(askedPlayers(t.engine, action), [{ id: "opp", candidates: others(count) }]);
      refused(() => activate(t.engine, P1, t.id("en"), "recur"), "no opponent named");
      activate(t.engine, P1, t.id("en"), "recur", { players: { opp: chosen } });
      assert.equal(zoneOf(t.engine, t.id("en")), "removed");
      const pc = pending(t.engine)!;
      assert.equal(pc.playerId, P1);
      assert.deepEqual(candidates(t, pc), [t.id(`ch-${chosen}`), t.id(`it-${chosen}`)], "only the named opponent's non-resource cards");
      const stranger = others(count).find((p) => p !== chosen)!;
      refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`ch-${stranger}`)] }), "another opponent's card");
      refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`rs-${chosen}`)] }), "a resource");
      answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`it-${chosen}`)] });
      assert.equal(zoneOf(t.engine, t.id(`it-${chosen}`)), "discard");
      assert.equal(hand(t.engine, chosen).length, 2);
      for (const p of others(count).filter((o) => o !== chosen)) assert.equal(hand(t.engine, p).length, 3, `${p}'s hand unchanged`);
    }
  });
}

// =========================================================================================
// ENTER THE DEMON KNIGHTS
// =========================================================================================

const ETDK = "1848963f-93a8-4eae-8977-f76b2547bce5";

const enterKnights = (count: number, extra: CardPlacement[] = []) =>
  table(count, [
    { key: "et", def: printing(ETDK), owner: P1, zone: "hand" },
    ...res("obsession", 4, P1),
    { key: "c1", def: character({ name: "Revealed 1", cost: 2 }), owner: P1, zone: "hand" },
    { key: "c2", def: character({ name: "Revealed 2", cost: 2, subtype: ["demon knight"] }), owner: P1, zone: "hand" },
    { key: "c3", def: character({ name: "Revealed 3", cost: 2, unique: "gloamspike" } as never), owner: P1, zone: "hand" },
    { key: "c4", def: character({ name: "Kept in hand", cost: 2 }), owner: P1, zone: "hand" },
    ...pad("oh", others(count), 2, "hand"),
    ...extra
  ]);

for (const count of [3, 4] as const) {
  const revealed = (t: Table) => [t.id("c1"), t.id("c2"), t.id("c3")];
  clause(ETDK, "0:extraCost", `${count} seats: the play picks one opponent (offered every opponent, never P1); only that opponent is involved afterwards`, () => {
    const probe = enterKnights(count);
    assert.deepEqual(askedPlayers(probe.engine, { type: "playCard", playerId: P1, cardId: probe.id("et"), selected: { revealed: revealed(probe) }, variables: {} }), [{ id: "picked", candidates: others(count) }]);
    refused(() => play(probe.engine, P1, probe.id("et"), { selected: { revealed: revealed(probe) } }), "no opponent picked");
    for (const picked of others(count)) {
      const t = enterKnights(count);
      play(t.engine, P1, t.id("et"), { selected: { revealed: revealed(t) }, players: { picked } });
      const pc = pending(t.engine)!;
      assert.equal(pc.kind, "chooserSelectsTarget");
      assert.equal(pc.playerId, picked, "only the picked opponent is asked");
      assert.deepEqual(candidates(t, pc).sort(), revealed(t).sort());
    }
  });

  clause(ETDK, "0:extraCost", `${count} seats: not during a battle (P1's attack on another seat blocks it)`, () => {
    const t = enterKnights(count, [{ key: "atk", def: character({ name: "Attacker" }), owner: P1, zone: "play" }]);
    declareAttackBy(t.engine, P1, [t.id("atk")], { type: "faction", playerId: P3 });
    assert.ok(t.engine.state.battle, "a battle is underway");
    refused(() => play(t.engine, P1, t.id("et"), { selected: { revealed: revealed(t) }, players: { picked: P3 } }), "deploying during a battle");
    assert.equal(zoneOf(t.engine, t.id("et")), "hand");
  });

  clause(ETDK, "1:rule", `${count} seats: only the picked opponent chooses one revealed character; it (and the revealed demon knight / GLOAMSPIKE) enter under P1's control`, () => {
    for (const picked of others(count)) {
      const t = enterKnights(count);
      play(t.engine, P1, t.id("et"), { selected: { revealed: revealed(t) }, players: { picked } });
      const stranger = others(count).find((p) => p !== picked)!;
      refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [t.id("c4")] }), "an unrevealed card");
      assert.equal(pending(t.engine)!.playerId, picked);
      answer(t.engine, "chooserSelectsTarget", { selected: [t.id("c1")] });
      assert.equal(pending(t.engine), undefined, `${stranger} (and every other opponent) is never asked`);
      for (const key of ["c1", "c2", "c3"]) {
        assert.equal(zoneOf(t.engine, t.id(key)), "play", `${key} enters play`);
        assert.equal(cardOf(t, t.id(key)).controllerId, P1, `${key} under P1's control`);
      }
      assert.equal(zoneOf(t.engine, t.id("c4")), "hand");
      for (const p of others(count)) assert.equal(hand(t.engine, p).length, 2, `${p}'s hand unchanged`);
    }
  });
}

// =========================================================================================
// ESSENCE OF OBSESSION
// =========================================================================================

const EOO = "629788f8-2303-4e43-be24-719ef508dc4e";

const essence = (count: number) =>
  table(count, [
    { key: "eoo", def: printing(EOO), owner: P1, zone: "hand" },
    ...res("obsession", 2, P1),
    ...pad("h", others(count), 3, "hand"),
    ...others(count).map((p): CardPlacement => ({ key: `c-${p}`, def: character({ name: `${p} char`, strength: 4 }), owner: p, zone: "play" })),
    { key: "c-p1", def: character({ name: "P1 char", strength: 4 }), owner: P1, zone: "play" }
  ]);

for (const count of [3, 4] as const) {
  const asks = (t: Table, mode: number) => askedPlayers(t.engine, { type: "playCard", playerId: P1, cardId: t.id("eoo"), selected: {}, variables: {}, mode });

  clause(EOO, "0:rule", `${count} seats: P1 alone chooses the option; no opponent is asked who plays it`, () => {
    const t = essence(count);
    play(t.engine, P1, t.id("eoo"), { mode: 1, selected: { c: [t.id("c-p1")] } });
    assert.equal(pending(t.engine), undefined);
    assert.equal(zoneOf(t.engine, t.id("eoo")), "discard");
  });

  clause(EOO, "1:option:OPTION 1", `${count} seats: OPTION 1 names one opponent with the play; only that opponent chooses a card of their own hand and discards it`, () => {
    for (const chosen of others(count)) {
      const t = essence(count);
      assert.deepEqual(asks(t, 0), [{ id: "opp", candidates: others(count) }]);
      refused(() => play(t.engine, P1, t.id("eoo"), { mode: 0 }), "no opponent named");
      play(t.engine, P1, t.id("eoo"), { mode: 0, players: { opp: chosen } });
      const pc = pending(t.engine)!;
      assert.equal(pc.kind, "chooserSelectsTarget");
      assert.equal(pc.playerId, chosen, "the named opponent chooses");
      const own = hand(t.engine, chosen);
      assert.deepEqual(candidates(t, pc).sort(), [...own].sort(), "only that opponent's hand");
      const stranger = others(count).find((p) => p !== chosen)!;
      refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [hand(t.engine, stranger)[0]!] }), "another opponent's card");
      answer(t.engine, "chooserSelectsTarget", { selected: [own[2]!] });
      assert.equal(zoneOf(t.engine, own[2]!), "discard");
      for (const p of others(count)) assert.equal(hand(t.engine, p).length, p === chosen ? 2 : 3, `${p}`);
    }
  });

  clause(EOO, "2:option:OPTION 2", `${count} seats: OPTION 2 picks any player's character (P3's too) for COVERT; no opponent is asked`, () => {
    for (const key of ["c-p3", "c-p2", "c-p1"]) {
      const t = essence(count);
      assert.equal(asks(t, 1), undefined, "no opponent step");
      play(t.engine, P1, t.id("eoo"), { mode: 1, selected: { c: [t.id(key)] } });
      assert.equal(pending(t.engine), undefined);
      assert.ok([...(t.engine.getKeywords(t.id(key)) as Iterable<string>)].map((k) => String(k).toLowerCase()).includes("covert"), `${key} gains COVERT`);
      for (const other of ["c-p3", "c-p2", "c-p1"].filter((k) => k !== key)) {
        assert.ok(![...(t.engine.getKeywords(t.id(other)) as Iterable<string>)].map((k) => String(k).toLowerCase()).includes("covert"), `${other} does not`);
      }
    }
  });

  clause(EOO, "3:option:OPTION 3", `${count} seats: OPTION 3 picks any player's character (P2's too) for -2 strength; no opponent is asked`, () => {
    for (const key of ["c-p2", "c-p3", "c-p1"]) {
      const t = essence(count);
      assert.equal(asks(t, 2), undefined, "no opponent step");
      play(t.engine, P1, t.id("eoo"), { mode: 2, selected: { c: [t.id(key)] } });
      assert.equal(pending(t.engine), undefined);
      assert.equal(t.engine.getStat(t.id(key), "strength"), 2);
      for (const other of ["c-p3", "c-p2", "c-p1"].filter((k) => k !== key)) assert.equal(t.engine.getStat(t.id(other), "strength"), 4, `${other} untouched`);
    }
  });
}

// =========================================================================================
// FLAGITIOUS DENUNCIATOR
// =========================================================================================

const FD = "7599bef0-0817-4597-b58b-b4903cd54069";

const denunciator = (count: number) =>
  table(count, [
    { key: "fd", def: printing(FD), owner: P1, zone: "play" },
    ...res("obsession", 2, P1),
    ...oppHands(count),
    ...others(count).map((p): CardPlacement => ({ key: `pc-${p}`, def: character({ name: `${p} bounced` }), owner: p, zone: "play" }))
  ]);

for (const count of [3, 4] as const) {
  clause(FD, "1:ability:denounce", `${count} seats: DENOUNCE bounces the picked character to its owner, and names one opponent whose hand only P1 looks at for a character to discard`, () => {
    for (const chosen of others(count)) {
      const t = denunciator(count);
      const stranger = others(count).find((p) => p !== chosen)!;
      const action = { type: "activateAbility", playerId: P1, cardId: t.id("fd"), abilityId: "denounce", selected: { c: [t.id(`pc-${stranger}`)] }, variables: {} };
      assert.deepEqual(askedPlayers(t.engine, action), [{ id: "opp", candidates: others(count) }]);
      refused(() => activate(t.engine, P1, t.id("fd"), "denounce", { selected: { c: [t.id(`pc-${stranger}`)] } }), "no opponent named");
      activate(t.engine, P1, t.id("fd"), "denounce", { selected: { c: [t.id(`pc-${stranger}`)] }, players: { opp: chosen } });
      assert.equal(zoneOf(t.engine, t.id("fd")), "discard", "COST: destroyed");
      assert.equal(zoneOf(t.engine, t.id(`pc-${stranger}`)), "hand", "the picked character went to its owner's hand");
      assert.ok(hand(t.engine, stranger).includes(t.id(`pc-${stranger}`)));
      const pc = pending(t.engine)!;
      assert.equal(pc.kind, "chooserSelectsTarget");
      assert.equal(pc.playerId, P1, "P1 chooses");
      assert.deepEqual(candidates(t, pc), [t.id(`ch-${chosen}`)], "only a character in the named opponent's hand (the bounced one is the other opponent's)");
      refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`pc-${stranger}`)] }), "a character in the other opponent's hand");
      answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`ch-${chosen}`)] });
      assert.equal(zoneOf(t.engine, t.id(`ch-${chosen}`)), "discard");
      assert.equal(hand(t.engine, chosen).length, 2);
      assert.equal(hand(t.engine, stranger).length, 4, "the other opponent only got the bounced character back");
    }
  });
}

// =========================================================================================
// FORBIDDEN KNOWLEDGE
// =========================================================================================

const FK = "6242776d-806e-4e6b-a360-30c791143c36";

const forbidden = (count: number) =>
  table(count, [
    { key: "fk", def: printing(FK), owner: P1, zone: "hand" },
    ...res("obsession", 2, P1),
    ...pad("d", seats(count), 3, "deck"),
    ...pad("h", others(count), 3, "hand"),
    ...others(count).map((p): CardPlacement => ({ key: `fd-${p}`, def: resourceCard({ name: `${p} face-down resource` }), owner: p, zone: "play", faceDown: true }))
  ]);

/** What `viewer` was shown (cardsRevealed events from the log) as `{ owner, zone, cardIds }`. */
const shownTo = (t: Table, viewer: PlayerId) =>
  t.engine
    .getLog()
    .map((entry) => entry.event as unknown as { type: string; cardIds: string[]; ownerId: PlayerId; zone: string; viewerId: string } | undefined)
    .filter((event): event is NonNullable<typeof event> => event?.type === "cardsRevealed" && event.viewerId === viewer);

for (const count of [3, 4] as const) {
  clause(FK, "0:rule", `${count} seats: P1 names one opponent; P1 is shown that opponent's hand, top card and face-down resources only; P1 draws either way`, () => {
    for (const chosen of others(count)) {
      const t = forbidden(count);
      const action = { type: "playCard", playerId: P1, cardId: t.id("fk"), selected: {}, variables: {} };
      assert.deepEqual(askedPlayers(t.engine, action), [{ id: "opp", candidates: others(count) }]);
      refused(() => play(t.engine, P1, t.id("fk")), "no opponent named");
      play(t.engine, P1, t.id("fk"), { players: { opp: chosen } });
      const shown = shownTo(t, P1);
      const seen = (zone: string, owner: PlayerId) => shown.filter((e) => e.ownerId === owner && e.zone === zone).flatMap((e) => e.cardIds);
      assert.deepEqual(seen("hand", chosen).sort(), [t.id(`h-${chosen}-0`), t.id(`h-${chosen}-1`), t.id(`h-${chosen}-2`)].sort(), "the named opponent's hand");
      assert.deepEqual(seen("deck", chosen), [deck(t.engine, chosen)[0]], "the top card of the named opponent's deck");
      for (const p of others(count).filter((o) => o !== chosen)) {
        assert.ok(!shown.some((e) => e.ownerId === p), `nothing of ${p}'s is shown`);
        assert.ok(!shown.some((e) => e.cardIds.includes(t.id(`fd-${p}`))), `${p}'s face-down resource is not shown`);
      }
      assert.equal(hand(t.engine, P1).length, 1, "P1 draws a card");
      for (const p of others(count)) assert.equal(hand(t.engine, p).length, 3, `${p}'s hand unchanged`);
    }
  });

  clauseMismatch(FK, "0:rule", "MP-seed-saga-101", `${count} seats: the look also covers the named opponent's face-down resources (and no other opponent's)`, () => {
    for (const chosen of others(count)) {
      const t = forbidden(count);
      play(t.engine, P1, t.id("fk"), { players: { opp: chosen } });
      const shown = shownTo(t, P1);
      assert.ok(shown.some((e) => e.ownerId === chosen && e.cardIds.includes(t.id(`fd-${chosen}`))), "the named opponent's face-down resource");
    }
  });
}

// =========================================================================================
// HIDEOUS HEXAPEDE OF HORROR
// =========================================================================================

const HEX = "0aaa4b25-4774-48c8-89ee-6c6884d96435";

/** A faction that starts at `influence` with no Develop choices. */
const faction = (influence: number) =>
  factionCard({
    faction: defaultFactionDefinition({
      startingInfluence: influence,
      turn: { restore: { detachResources: true, restoreNonResources: true }, develop: { choices: [] } }
    })
  });

function hexapede(count: number, influence: number) {
  const built = buildGame({
    playerA: { faction: faction(influence) },
    playerB: { faction: faction(influence) },
    extraPlayers: Array.from({ length: count - 2 }, () => ({ faction: faction(influence) })),
    random: () => 0.5,
    cards: [
      { key: "hex", def: printing(HEX), owner: P1, zone: "play" },
      ...res("obsession", 6, P1),
      ...pad("h", seats(count), 7, "hand"),
      ...pad("x", seats(count), 7, "discard"),
      ...pad("d", seats(count), 8, "deck"),
      ...[P1, P2, P3].flatMap((p) => many(`v-${p}-`, 2, p, "play", (i) => character({ name: `${p} victim ${i}`, life: 3 })))
    ]
  });
  return { engine: built.engine, id: built.id, seats: seatsOf(count) } as Table;
}

for (const count of [3, 4] as const) {
  clause(HEX, "0:ability:hellish-hex", `${count} seats: ALL players (P1 included) remove 6 from hand, 6 from discard and the top 6 of the deck, in turn order; every faction takes 6 damage`, () => {
    const t = hexapede(count, 25);
    const victims = [P1, P2, P3].flatMap((p) => [t.id(`v-${p}-0`), t.id(`v-${p}-1`)]);
    activate(t.engine, P1, t.id("hex"), "hellish-hex", { selected: { victims } });
    const seen = run(t);
    const order = [...new Set(seen.map((pc) => pc.playerId))];
    assert.deepEqual(order, seats(count), "every player acts, P1 (active) first, then clockwise");
    for (const p of seats(count)) {
      const removed = Object.values(t.engine.state.cards).filter((c) => c.ownerId === p && c.zone === "removed");
      assert.equal(removed.length, 18, `${p}: 6 from hand, 6 from discard, 6 from deck`);
      assert.equal(hand(t.engine, p).length, 1, `${p}'s hand: 7 - 6`);
      assert.equal(deck(t.engine, p).length, 2, `${p}'s deck: 8 - 6`);
      assert.equal(t.engine.state.players[p]!.influence, 19, `${p}'s faction took 6 damage`);
    }
    for (const key of victims) assert.equal(zoneOf(t.engine, key), "discard", "the six picked characters died");
    assert.notEqual(zoneOf(t.engine, t.id("hex")), "play", "destroyed as a cost");
  });

  clause(HEX, "0:ability:hellish-hex", `${count} seats: factions that reach 0 together lose together (a draw)`, () => {
    const t = hexapede(count, 6);
    const victims = [P1, P2, P3].flatMap((p) => [t.id(`v-${p}-0`), t.id(`v-${p}-1`)]);
    activate(t.engine, P1, t.id("hex"), "hellish-hex", { selected: { victims } });
    run(t);
    for (const p of seats(count)) assert.equal(t.engine.state.players[p]!.influence, 0, `${p}`);
    assert.equal(t.engine.state.winner, "draw");
  });
}

// =========================================================================================
// IMPERIAL THAUMATURGE
// =========================================================================================

const IT = "7c5a0e32-65ca-4f3d-937e-91df2737cdd1";

const thaumaturge = (count: number) =>
  table(count, [{ key: "it", def: printing(IT), owner: P1, zone: "play" }, ...res("obsession", 1, P1), ...pad("h", others(count), 3, "hand")]);

for (const count of [3, 4] as const) {
  clause(IT, "0:ability:tickle", `${count} seats: TICKLE names one opponent; only that opponent chooses a card of their hand and discards it`, () => {
    for (const chosen of others(count)) {
      const t = thaumaturge(count);
      const action = { type: "activateAbility", playerId: P1, cardId: t.id("it"), abilityId: "tickle", selected: {}, variables: {} };
      assert.deepEqual(askedPlayers(t.engine, action), [{ id: "opp", candidates: others(count) }]);
      refused(() => activate(t.engine, P1, t.id("it"), "tickle"), "no opponent named");
      activate(t.engine, P1, t.id("it"), "tickle", { players: { opp: chosen } });
      assert.equal(cardOf(t, t.id("it")).depleted, true, "COST: deplete");
      assert.equal(ready(t.engine, P1), 0, "COST: pay 1");
      const pc = pending(t.engine)!;
      assert.equal(pc.kind, "chooserSelectsTarget");
      assert.equal(pc.playerId, chosen, "the named opponent chooses");
      const own = hand(t.engine, chosen);
      assert.deepEqual(candidates(t, pc).sort(), [...own].sort(), "only that opponent's hand");
      const stranger = others(count).find((p) => p !== chosen)!;
      refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [hand(t.engine, stranger)[0]!] }), "another opponent's card");
      answer(t.engine, "chooserSelectsTarget", { selected: [own[1]!] });
      assert.equal(zoneOf(t.engine, own[1]!), "discard");
      for (const p of others(count)) assert.equal(hand(t.engine, p).length, p === chosen ? 2 : 3, `${p}`);
    }
  });
}

// =========================================================================================
// LIVING GOD OF THABBASH
// =========================================================================================

const LG = "f0bbd413-27be-4fb1-ac4a-f12f0dc29860";
const ENC = "55946c3c-d213-4948-9656-53bb189e4d49"; // Encumber: bounces any character, to test an opponent's character leaving

const livingGod = (count: number) =>
  table(count, [
    { key: "lg", def: printing(LG), owner: P1, zone: "play" },
    { key: "mine", def: character({ name: "P1 char" }), owner: P1, zone: "play" },
    { key: "enc", def: printing(ENC), owner: P1, zone: "hand" },
    ...res("obsession", 6, P1),
    ...others(count).map((p): CardPlacement => ({ key: `oc-${p}`, def: character({ name: `${p} char` }), owner: p, zone: "play" })),
    ...pad("h", others(count), 3, "hand")
  ]);

for (const count of [3, 4] as const) {
  clause(LG, "0:rule", `${count} seats: when P1's character leaves play, P1 chooses one opponent and only that opponent discards a card of their choice`, () => {
    for (const chosen of others(count)) {
      const t = livingGod(count);
      activate(t.engine, P1, t.id("lg"), "higher-calling", { selected: { c: [t.id("mine")] } });
      const seen = run(t, (pc) => {
        if (pc.kind === "choosePlayer") return { kind: pc.kind, playerId: chosen };
        return undefined;
      });
      assert.equal(zoneOf(t.engine, t.id("mine")), "hand");
      const chooses = seen.filter((pc) => pc.kind === "choosePlayer");
      assert.equal(chooses.length, 1, "exactly one opponent is chosen");
      assert.equal(chooses[0]!.playerId, P1);
      assert.deepEqual([...(chooses[0]!.candidates as PlayerId[])].sort(), others(count), "P1 is never offered");
      const picks = seen.filter((pc) => pc.kind === "chooserSelectsTarget");
      assert.equal(picks.length, 1);
      assert.equal(picks[0]!.playerId, chosen, "the chosen opponent picks what they discard");
      for (const p of others(count)) assert.equal(hand(t.engine, p).length, p === chosen ? 2 : 3, `${p}`);
    }
  });

  clause(LG, "0:rule", `${count} seats: a character controlled by an opponent leaving play does not trigger it`, () => {
    for (const owner of others(count)) {
      const t = livingGod(count);
      play(t.engine, P1, t.id("enc"), { selected: { t: [t.id(`oc-${owner}`)] } });
      const seen = run(t);
      assert.equal(zoneOf(t.engine, t.id(`oc-${owner}`)), "hand", "it left play");
      assert.deepEqual(kinds(seen), [], "nobody is asked anything");
      for (const p of others(count)) assert.equal(hand(t.engine, p).length, p === owner ? 4 : 3, `${p} discards nothing`);
    }
  });
}

// =========================================================================================
// NEFARIOUS HORROR
// =========================================================================================

const NH = "6a568b43-e53e-4c0f-915d-df90aa61872e";
/** P1 plays the Horror with `mine - 1` more characters in play (so P1 controls `mine`); `theirs[i]` characters for opponent i. */
/** P1 plays the Horror with `mine - 1` more characters in play (so P1 controls `mine`), and `theirs[i]` characters for opponent i. (Old comment:  (so P1 controls `mine`), and `theirs[i]` characters for opponent i. */
const horror = (count: number, mine: number, theirs: number[]) => {
  const t = table(count, [
    { key: "nh", def: printing(NH), owner: P1, zone: "hand" },
    ...res("obsession", 4, P1),
    ...many("m", mine - 1, P1, "play", (i) => character({ name: `P1 char ${i}` })),
    ...others(count).flatMap((p, i) => many(`o-${p}-`, theirs[i] ?? 0, p, "play", (n) => character({ name: `${p} char ${n}` })))
  ]);
  play(t.engine, P1, t.id("nh"));
  assert.equal(zoneOf(t.engine, t.id("nh")), "play");
  return t;
};
const keywordsOf = (t: Table, key: string): string[] => [...(t.engine.getKeywords(t.id(key)) as Iterable<string>)].map((k) => String(k).toLowerCase());

for (const count of [3, 4] as const) {
  const pad4 = (theirs: number[]) => (count === 4 ? [...theirs, 0] : theirs);
  const grows = (t: Table) => {
    assert.equal(pending(t.engine), undefined, "the controller is asked nothing");
    return t.engine.getStat(t.id("nh"), "strength") === 4 && t.engine.getStat(t.id("nh"), "life") === 4 && !keywordsOf(t, "nh").includes("covert");
  };
  const plain = (t: Table) => t.engine.getStat(t.id("nh"), "strength") === 2 && t.engine.getStat(t.id("nh"), "life") === 2 && keywordsOf(t, "nh").includes("covert");

  clauseMismatch(NH, "1:rule", "MP-seed-saga-102", `${count} seats: holds while any single opponent controls more characters than P1 (counts never pooled); the controller makes no choice`, () => {
    // P1 controls 3: P2 has 2 and P3 has 4 -> holds (P3)
    const a = horror(count, 3, pad4([2, 4]));
    assert.ok(grows(a), "P3 controls 4 > 3: +2 strength, +2 life, no COVERT");
    // P2 has 5, P3 has 1 -> holds (P2)
    const b = horror(count, 3, pad4([5, 1]));
    assert.ok(grows(b), "P2 controls 5 > 3");
    // 2 and 2 (4 together): neither more than 3 -> does not hold
    const c = horror(count, 3, pad4([2, 2]));
    assert.equal(pending(c.engine), undefined, "the controller is asked nothing");
    assert.ok(plain(c), "counts are not pooled");
    // both equal to 3 -> does not hold
    const d = horror(count, 3, pad4([3, 3]));
    assert.ok(plain(d), "equal is not more");
  });
}

// =========================================================================================
// OBSCENE COMMUNION
// =========================================================================================

const OC = "65721d28-4626-40df-a980-d153c8e5fd15";

/** P1 controls the Communion; `starter`'s turn is about to start (the seat before it is active). */
const communion = (count: number, starter: PlayerId) => {
  const order = seats(count);
  const before = order[(order.indexOf(starter) + count - 1) % count]!;
  return table(
    count,
    [
      { key: "oc", def: printing(OC), owner: P1, zone: "play" },
      ...pad("h", order, 3, "hand"),
      ...pad("d", order, 3, "deck"),
      ...order.flatMap((p) => res("rage", 2, p)),
      { key: "stolen", def: resourceCard({ name: "P3 resource under P1" }), owner: P3, controller: P1, zone: "play" }
    ],
    before
  );
};
/** The seats in the order a turn starting at `starter` goes round the table. */
const from = (count: number, starter: PlayerId): PlayerId[] => {
  const order = seats(count);
  const i = order.indexOf(starter);
  return [...order.slice(i), ...order.slice(0, i)];
};
const firstSeen = (seen: PendingChoiceLike[]): PlayerId[] => [...new Set(seen.map((pc) => pc.playerId as PlayerId))];

for (const count of [3, 4] as const) {
  clause(OC, "0:rule", `${count} seats: at the start of EACH player's turn only that player (not P1, not the others) is offered the four options`, () => {
    for (const starter of seats(count)) {
      const t = communion(count, starter);
      endTurn(t.engine, t.engine.state.activePlayerId);
      assert.equal(t.engine.state.activePlayerId, starter);
      const pc = pending(t.engine)!;
      assert.equal(pc.kind, "chooserSelectsOption");
      assert.equal(pc.playerId, starter, "the player whose turn it is chooses");
      assert.equal(pc.optionCount, 4);
      const seen = run(t);
      assert.equal(seen.filter((p) => p.kind === "chooserSelectsOption").length, 1, "exactly one player chooses");
    }
  });

  clause(OC, "1:option:OPTION 1", `${count} seats: OPTION 1, every player draws a card and then puts a card from their own hand on the bottom of their own deck, starting with P2`, () => {
    const t = communion(count, P2);
    endTurn(t.engine, t.engine.state.activePlayerId);
    const bottomed: Record<string, string> = {};
    const seen = run(t, (pc) => {
      if (pc.kind === "chooserSelectsOption") return { kind: pc.kind, index: 0 };
      if (pc.kind === "chooserSelectsTarget") {
        const mine = hand(t.engine, pc.playerId as PlayerId);
        assert.equal(mine.length, 4, "the player has already drawn");
        bottomed[pc.playerId] = mine[3]!;
        return { kind: pc.kind, selected: [mine[3]!] };
      }
      return undefined;
    });
    assert.deepEqual(firstSeen(seen.filter((p) => p.kind === "chooserSelectsTarget")), from(count, P2), "P2, P3, ..., P1 each put a card on the bottom");
    for (const p of seats(count)) {
      assert.equal(hand(t.engine, p).length, 3, `${p} drew and bottomed one`);
      assert.equal(deck(t.engine, p)[deck(t.engine, p).length - 1], bottomed[p], `${p}'s card is on the bottom of ${p}'s own deck`);
      assert.equal(deck(t.engine, p).length, 3);
    }
  });

  clause(OC, "2:option:OPTION 2", `${count} seats: OPTION 2, every player puts a resource they control into its owner's hand (P3's resource under P1 goes to P3's hand) and may play a resource`, () => {
    const t = communion(count, P2);
    endTurn(t.engine, t.engine.state.activePlayerId);
    const seen = run(t, (pc) => {
      if (pc.kind === "chooserSelectsOption") return { kind: pc.kind, index: 1 };
      if (pc.kind === "chooserSelectsTarget" && !(pc.declaration as { optional?: boolean }).optional) {
        const cands = candidates(t, pc);
        for (const c of cands) assert.equal(cardOf(t, c).controllerId, pc.playerId, "only resources the player controls");
        return { kind: pc.kind, selected: [pc.playerId === P1 ? t.id("stolen") : cands[0]!] };
      }
      return { kind: pc.kind, selected: [] };
    });
    const bounces = seen.filter((p) => p.kind === "chooserSelectsTarget" && !(p.declaration as { optional?: boolean }).optional);
    assert.deepEqual(bounces.map((p) => p.playerId), from(count, P2), "P2, P3, ..., P1 each put a resource into its owner's hand");
    assert.equal(seen.filter((p) => p.kind === "chooserSelectsTarget" && (p.declaration as { optional?: boolean }).optional).length, count, "each player may play a resource");
    assert.equal(zoneOf(t.engine, t.id("stolen")), "hand");
    assert.ok(hand(t.engine, P3).includes(t.id("stolen")), "into its OWNER's hand");
    assert.ok(!hand(t.engine, P1).includes(t.id("stolen")));
    for (const p of seats(count)) {
      const inPlay = Object.values(t.engine.state.cards).filter((c) => c.ownerId === p && c.zone === "play" && t.engine.getDefinition(c.id).type === "resource" && c.id !== t.id("stolen"));
      assert.equal(inPlay.length, p === P1 ? 2 : 1, `${p}`);
    }
  });

  clause(OC, "3:option:OPTION 3", `${count} seats: OPTION 3, every player discards a card of their choice, starting with P2`, () => {
    const t = communion(count, P2);
    endTurn(t.engine, t.engine.state.activePlayerId);
    const seen = run(t, (pc) => (pc.kind === "chooserSelectsOption" ? { kind: pc.kind, index: 2 } : undefined));
    assert.deepEqual(firstSeen(seen.filter((p) => p.kind === "chooserSelectsTarget")), from(count, P2));
    for (const p of seats(count)) {
      assert.equal(hand(t.engine, p).length, 2, `${p} discarded one`);
      assert.equal(t.engine.state.players[p]!.discard.length, 1);
    }
  });

  clause(OC, "4:option:OPTION 4", `${count} seats: OPTION 4, every player puts a card from their own hand on top of their own deck, starting with P2`, () => {
    const t = communion(count, P2);
    endTurn(t.engine, t.engine.state.activePlayerId);
    const topped: Record<string, string> = {};
    const seen = run(t, (pc) => {
      if (pc.kind === "chooserSelectsOption") return { kind: pc.kind, index: 3 };
      if (pc.kind === "chooserSelectsTarget") {
        const mine = hand(t.engine, pc.playerId as PlayerId);
        topped[pc.playerId] = mine[1]!;
        return { kind: pc.kind, selected: [mine[1]!] };
      }
      return undefined;
    });
    assert.deepEqual(firstSeen(seen.filter((p) => p.kind === "chooserSelectsTarget")), from(count, P2));
    for (const p of seats(count)) {
      assert.equal(hand(t.engine, p).length, 2, `${p}`);
      assert.equal(deck(t.engine, p)[0], topped[p], `${p}'s card is on top of ${p}'s own deck`);
      assert.equal(deck(t.engine, p).length, 4);
    }
  });
}

// =========================================================================================
// PERTURB
// =========================================================================================

const PB = "7b12a2d9-6874-4141-8028-66581431090a";

const perturb = (count: number) =>
  table(count, [
    { key: "pb", def: printing(PB), owner: P1, zone: "hand" },
    ...res("obsession", 5, P1),
    ...oppHands(count),
    ...others(count).map((p): CardPlacement => ({ key: `pc-${p}`, def: character({ name: `${p} board char` }), owner: p, zone: "play" })),
    { key: "pi", def: item({ name: "board item" }), owner: P3, zone: "play" }
  ]);

for (const count of [3, 4] as const) {
  clause(PB, "0:rule", `${count} seats: Perturb names one opponent; only that hand is looked at, a non-resource card in it is discarded, then P1 may return a same-type card to its owner's hand`, () => {
    for (const chosen of others(count)) {
      const t = perturb(count);
      const stranger = others(count).find((p) => p !== chosen)!;
      const action = { type: "playCard", playerId: P1, cardId: t.id("pb"), selected: {}, variables: {} };
      assert.deepEqual(askedPlayers(t.engine, action), [{ id: "opp", candidates: others(count) }]);
      const need = requirements(t.engine, { ...action, players: { opp: chosen } }).find((r) => r.kind === "pick");
      assert.deepEqual([...(need!.candidates as string[])].sort(), [t.id(`ch-${chosen}`), t.id(`it-${chosen}`)].sort(), "only the named opponent's non-resource hand cards");
      refused(() => play(t.engine, P1, t.id("pb"), { selected: { disc: [t.id(`ch-${stranger}`)] }, players: { opp: chosen } }), "another opponent's card");
      refused(() => play(t.engine, P1, t.id("pb"), { selected: { disc: [t.id(`rs-${chosen}`)] }, players: { opp: chosen } }), "a resource card");
      refused(() => play(t.engine, P1, t.id("pb"), { selected: { disc: [t.id(`ch-${chosen}`)] } }), "no opponent named");
      play(t.engine, P1, t.id("pb"), { selected: { disc: [t.id(`ch-${chosen}`)] }, players: { opp: chosen } });
      assert.equal(zoneOf(t.engine, t.id(`ch-${chosen}`)), "discard");
      const pc = pending(t.engine)!;
      assert.equal(pc.kind, "chooserSelectsTarget");
      assert.equal(pc.playerId, P1);
      const cands = candidates(t, pc);
      assert.ok(cands.includes(t.id(`pc-${stranger}`)) && cands.includes(t.id(`pc-${chosen}`)), "any player's character of the same type");
      assert.ok(!cands.includes(t.id("pi")), "an item is not the same type");
      answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`pc-${stranger}`)] });
      assert.equal(zoneOf(t.engine, t.id(`pc-${stranger}`)), "hand");
      assert.ok(hand(t.engine, stranger).includes(t.id(`pc-${stranger}`)), "to its owner's hand");
      assert.equal(hand(t.engine, chosen).length, 2, `${chosen} lost the discarded card only`);
      assert.equal(hand(t.engine, stranger).length, 4, `${stranger}'s hand only got its own character back`);
      for (const p of others(count).filter((o) => o !== chosen && o !== stranger)) assert.equal(hand(t.engine, p).length, 3, `${p} untouched`);
    }
  });
}

// =========================================================================================
// PERTURBATIOUS WARLOCK
// =========================================================================================

const PW = "82b1ad07-d0b7-4a8a-820e-f4587d4ec574";

const warlock = (count: number) =>
  table(count, [{ key: "pw", def: printing(PW), owner: P1, zone: "hand" }, ...res("obsession", 2, P1), ...pad("h", others(count), 3, "hand"), ...pad("d", others(count), 3, "deck")]);

for (const count of [3, 4] as const) {
  clause(PW, "0:rule", `${count} seats: when the Warlock enters play P1 chooses one opponent; only that opponent puts a card of their hand on top of their deck`, () => {
    for (const chosen of others(count)) {
      const t = warlock(count);
      play(t.engine, P1, t.id("pw"));
      const seen = run(t, (pc) => {
        if (pc.kind === "choosePlayer") return { kind: pc.kind, playerId: chosen };
        if (pc.kind === "chooserSelectsTarget") return { kind: pc.kind, selected: [hand(t.engine, chosen)[1]!] };
        return undefined;
      });
      assert.equal(zoneOf(t.engine, t.id("pw")), "play");
      const chooses = seen.filter((pc) => pc.kind === "choosePlayer");
      assert.equal(chooses.length, 1, "exactly one opponent is chosen");
      assert.equal(chooses[0]!.playerId, P1);
      assert.deepEqual([...(chooses[0]!.candidates as PlayerId[])].sort(), others(count), "P1 is never offered");
      const picks = seen.filter((pc) => pc.kind === "chooserSelectsTarget");
      assert.equal(picks.length, 1);
      assert.equal(picks[0]!.playerId, chosen, "the chosen opponent picks");
      for (const p of others(count)) {
        assert.equal(hand(t.engine, p).length, p === chosen ? 2 : 3, `${p}`);
        assert.equal(deck(t.engine, p).length, p === chosen ? 4 : 3, `${p}'s deck`);
      }
      assert.equal(deck(t.engine, chosen)[0], t.id(`h-${chosen}-1`), "on top of their deck");
    }
  });
}

// =========================================================================================
// REDONKULOUS
// =========================================================================================

const RD = "d329cfed-7a85-4e4e-86e9-65b7fa01cb6b";

/** `hands[p]` cards in each opponent's hand (and 5 in P1's); Redonkulous is in P1's hand, or face-down in play for a FLIP UP. */
const redonk = (count: number, hands: Record<string, number>, flip: boolean) =>
  table(count, [
    flip ? { key: "rd", def: printing(RD), owner: P1, zone: "play", faceDown: true } : { key: "rd", def: printing(RD), owner: P1, zone: "hand" },
    ...(flip ? [...res("obsession", 2, P1), ...res("rage", 3, P1)] : res("obsession", 3, P1)),
    ...seats(count).flatMap((p) => [
      ...pad("h", [p], hands[p] ?? 5, "hand"),
      { key: `t-${p}`, def: character({ name: `${p} target` }), owner: p, zone: "play" } as CardPlacement
    ])
  ]);
/** FLIP UP is deploying the card: every other seat passes in the response window (flipUpNow only passes for one). */
const flipUp = (t: Table, key: string) => {
  t.engine.perform({ type: "flipUp", playerId: P1, cardId: t.id("rd"), selected: { char: [t.id(key)] }, variables: {} } as never);
  resolvePendingResponses(t.engine);
};

for (const count of [3, 4] as const) {
  clause(RD, "0:extraCost", `${count} seats: a P3, a P2 or a P1 character are each a legal pick`, () => {
    for (const p of seats(count)) {
      const t = redonk(count, {}, false);
      play(t.engine, P1, t.id("rd"), { selected: { char: [t.id(`t-${p}`)] } });
      assert.equal(zoneOf(t.engine, t.id("rd")), "discard", `${p}'s character picked`);
    }
  });

  clause(RD, "1:rule", `${count} seats: FLIP UP makes the picked character's own controller (not another opponent) discard 2, then judges THEIR hand: 3 or fewer removes the character, 4 or more keeps it`, () => {
    for (const p of others(count)) {
      for (const [size, removed] of [[5, true], [6, false]] as const) {
        const t = redonk(count, { [p]: size }, true);
        flipUp(t, `t-${p}`);
        const pc = pending(t.engine)!;
        assert.equal(pc.kind, "chooserSelectsTarget");
        assert.equal(pc.playerId, p, "the character's controller discards");
        assert.deepEqual(candidates(t, pc).sort(), [...hand(t.engine, p)].sort(), "from their own hand");
        const own = hand(t.engine, p);
        answer(t.engine, "chooserSelectsTarget", { selected: [own[0]!, own[1]!] });
        assert.equal(pending(t.engine), undefined);
        assert.equal(hand(t.engine, p).length, size - 2);
        assert.equal(zoneOf(t.engine, t.id(`t-${p}`)), removed ? "removed" : "play", `${p} with ${size - 2} cards left`);
        for (const other of seats(count).filter((s) => s !== p)) {
          assert.equal(hand(t.engine, other).length, 5, `${other}'s hand unchanged`);
          assert.equal(zoneOf(t.engine, t.id(`t-${other}`)), "play", `${other}'s character stays`);
        }
      }
    }
  });

  clause(RD, "1:rule", `${count} seats: FLIP UP picking P1's own character makes P1 discard 2`, () => {
    const t = redonk(count, { [P1]: 5 }, true);
    flipUp(t, "t-p1");
    const pc = pending(t.engine)!;
    assert.equal(pc.playerId, P1);
    const own = hand(t.engine, P1);
    answer(t.engine, "chooserSelectsTarget", { selected: [own[0]!, own[1]!] });
    assert.equal(hand(t.engine, P1).length, 3);
    for (const other of others(count)) assert.equal(hand(t.engine, other).length, 5, `${other} discards nothing`);
  });
}

// @@END
