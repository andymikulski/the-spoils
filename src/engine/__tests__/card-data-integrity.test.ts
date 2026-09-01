// Guards the card-coverage system (data/card-coverage.json + COVERAGE.md,
// built by scripts/build-coverage.cjs) and the hand-authored `behavior` data
// in data/cards.json. See BEHAVIORS.md -> "Coverage workflow".
//
// This is a DATA test, not an engine-rules test: it doesn't build games, it
// checks that the catalog and the coverage manifest agree, that authored
// behavior parses against the known vocabulary, and that the "one pass"
// invariant holds (nothing reaches `authored`/`verified` while it still needs
// an unimplemented engine capability).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readJson = (rel: string) =>
  JSON.parse(readFileSync(ROOT + rel, "utf8"));

interface CardDef {
  id: string;
  name: string;
  set: string;
  type: string;
  text?: string;
  structure?: number;
  unique?: string;
  attachTo?: string;
  resource?: { provides?: string[] };
  faction?: unknown;
  behavior?: {
    keywords?: string[];
    abilities?: Array<Record<string, unknown>>;
  };
}

interface CoverageEntry {
  id: string;
  name: string;
  set: string;
  type: string;
  status: string;
  textHash: string;
  rulesAudited?: boolean;
  behavior: {
    needed: boolean;
    shapes: string[];
    reusesProvenShape: boolean | null;
    newTestNeeded: boolean;
  };
  metadata: {
    unique: string | null;
    attachTo: string | null;
    resourceProvides: string[] | null;
    keywords: string[];
  };
  engineCapability: string[];
  parityGaps?: string[];
  display: Record<string, unknown>;
  confidence: string | null;
  notes: string;
}

interface Capability {
  status: "unimplemented" | "designed" | "implemented";
  kind: string[];
  spec: string;
  cards?: string[];
  rulesRef?: string;
}

interface ParityGap {
  summary: string;
  clause?: string;
  needs: string;
  scope: string;
}

interface Manifest {
  statuses: string[];
  capabilities: Record<string, Capability>;
  parityGaps?: Record<string, ParityGap>;
  cards: CoverageEntry[];
}

const catalog: CardDef[] = readJson("data/cards.json");
const manifest: Manifest = readJson("data/card-coverage.json");
// A card flagged `reusesProvenShape: false` must be named by a test — in
// `card-behaviors.test.ts` (the general convention) or a set-specific
// `*-newshapes.test.ts` companion.
const behaviorsTestSrc = [
  "src/engine/__tests__/card-behaviors.test.ts",
  "src/engine/__tests__/holy-heist-newshapes.test.ts",
  "src/engine/__tests__/first-ed-part2-smoke.test.ts",
  "src/engine/__tests__/open-beta-caps.test.ts",
  "src/engine/__tests__/open-beta-smoke.test.ts",
  "src/engine/__tests__/first-edition-caps.test.ts",
  "src/engine/__tests__/first-edition-smoke.test.ts",
  "src/engine/__tests__/seed-caps.test.ts",
  "src/engine/__tests__/seed-smoke.test.ts"
]
  .map(rel => {
    try {
      return readFileSync(ROOT + rel, "utf8");
    } catch {
      return "";
    }
  })
  .join("\n");

const STATUSES = [
  "unclassified",
  "vanilla",
  "classified",
  "authored",
  "verified",
  "blocked",
  "wontImplement"
];

// -- known vocabulary (mirrors src/types/*; kept flat on purpose — this is a
//    typo / unknown-tag guard for hand-authored JSON, not a full schema) -----
const ABILITY_TYPES = new Set([
  "activated",
  "triggered",
  "continuous",
  "replacement"
]);
const EVENT_TYPES = new Set([
  "turnStarted", "turnEnding", "cardPlayed", "cardEnteredPlay", "cardMoved",
  "cardDestroyed", "cardDepleted", "cardRestored", "resourcePlayed",
  "damageDealt", "abilityActivated", "battleStarted", "battleEnded",
  "characterAttacked", "characterBlocked", "blockingPartyFormed", "cardsDrawn",
  "cardsDiscarded", "counterChanged", "attackerBlocked", "deckSearched",
  "coinFlipped", "cardPicked"
]);
const KEYWORDS = new Set([
  "tactical", "aggro", "covert", "redirectDamage", "cannotBeBlocked",
  "canBlockCovert", "canBlockAnyParty"
]);
const KNOWN_TYPE_TAGS = new Set([
  ...ABILITY_TYPES,
  // effects
  "draw", "playResource", "dealDamage", "modifyInfluence", "moveCard",
  "destroy", "deplete", "restore", "addCounter", "removeCounter",
  "createModifier", "takeControl", "removeFromGame", "forEach", "attachTo",
  "grantKeyword", "grantRestriction", "restrictPlay", "modifyOutgoingDamage",
  "alternatingPayLoop", "if", "shuffleDeck",
  "mill", "bind",
  "terminate", "setRestoreLock", "setDamage", "removeFromBattle", "addToBattle",
  "forEachPlayer", "nameValue", "mayPay", "createTokens", "useTargetAbility",
  "chooserSelectsTarget", "chooserSelectsOption", "lookAndReorder",
  "reduceNextCost", "deployForFree", "distributeAmong",
  "flipFaceDown", "putIntoPlay", "deployFromZone", "detach", "scheduleEffect",
  "preventDamage", "rememberTarget", "grantResourceIcons", "grantProvides",
  "skipRestoreRule", "skipNextRestore", "modifyNumericCost",
  "chooserSelectsNumber", "reduceThreshold", "anyPlayerMayPay",
  "useAnyAbility",
  "duplicate", "oneOf", "setCardType", "removeCardType", "retargetExtraCost",
  "partitionAndPick",
  "healDamage", "suppressAbilities", "suppressKeyword", "grantKeywordToPlayer",
  "transformBattleDamage", "randomFromSelection", "separateIntoPiles",
  "grantVoidPlay",
  // 1st Edition Part 2 effects
  "lockAbilityThisTurn", "flipCoin", "restrictBlockers",
  "restrictBlockersToChosen", "grantAbilitiesFrom", "initiateAttack",
  "auctionForCard",
  // Ungodly Mess effects
  "preventAllDamage", "restrictDestruction",
  // Open Beta effects / expressions / conditions
  "grantSubtype", "redirectHandMoves", "installReplacement", "spendCountersMenu",
  "eventDrawAmount", "deploysThisTurn", "lastDeployedTactic", "attackedThisTurn",
  "endOfBattle",
  // 1st Edition effects
  "restrictParty",
  // Seed effects / expressions
  "redirectAttackTarget", "sumCost",
  // costs
  "payResources", "discard", "depleteSelected", "sacrificeSelected",
  "loseInfluence", "moveSelected",
  // conditions
  "and", "or", "not", "sourceInZone", "sourceIsEventCard",
  "eventCardControlledBy", "targetExists", "cardTypeIs", "cardTradeIs",
  "hasUnique", "hasAbility", "statCompare", "counterCompare", "numberCompare", "inBattle",
  "sourceIsDamageSource", "cardMovedFromZone", "cardMovedToZone", "battleRole", "eventPlayerIs",
  "targetInSelection", "eventOrdinal", "deploySameNameThisTurn",
  "respondingTo", "respondedToPicked", "deployedViaFlipUp", "cardNameEquals",
  "bottomedInMulligan", "cardNameIs",
  "cardProvides", "isStaple", "cardDepleted", "cardTypeEquals", "sourceIsFaceDown",
  "isExtremum", "linkedCardInPlay", "sharesBattlePartyWithSource", "remembered",
  "isActivePlayer", "battleActive", "cardSubtypeIs", "inPlaySinceTurnStart",
  "uniqueIs", "assignedDamageThisTurn", "inflictedDamageToFactionThisTurn",
  "hasAttachment", "hasKeyword", "textMentionsIcon", "isToken", "eventCardIs",
  "targetInZone", "battleTargetIs", "battleDamageAssigned",
  // 1st Edition Part 2 conditions
  "isCard", "damagedThisTurn", "destroyedByBattleDamage",
  // number expressions
  "stat", "counter", "count", "add", "multiply", "variable", "random",
  "cardCost", "printedStat", "resourceIcons", "divide", "modulo",
  "selectionCount", "conditional", "sumStat", "sumCounters",
  "thresholdIconCount", "eventDamageAmount",
  // 1st Edition Part 2 number expressions
  "battlePartySize", "extremumStat",
  // Ungodly Mess number expressions
  "distinctCount",
  // target refs / player refs
  "selected", "card", "player", "ownerOf", "controllerOf", "deckPosition",
  "respondedToCard", "damageSource", "factionOf",
  // 1st Edition Part 2 target refs
  "attachmentHost", "respondedAbilitySource",
  // replacement ability event tags (under `replaces.event`, not `type`, but
  // harmless to allow)
  "moveToZone", "coinFlip",
  // durations
  "permanent", "untilEndOfTurn", "untilStartOfNextTurn", "whileSourceInPlay",
  // CardType, as it legitimately appears under CardSelector.type
  "character", "item", "location", "tactic", "resource", "faction"
]);

const catalogById = new Map(catalog.map(c => [c.id, c]));
const entryById = new Map(manifest.cards.map(e => [e.id, e]));

function textHashOf(text: string | undefined): string {
  return createHash("sha1")
    .update((text || "").replace(/\s+/g, " ").trim(), "utf8")
    .digest("hex")
    .slice(0, 12);
}

/** Every string value sitting under a `type:` key, anywhere in `node`. */
function collectTypeTags(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const v of node) collectTypeTags(v, out);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "type" && typeof v === "string") out.push(v);
      collectTypeTags(v, out);
    }
  }
}

describe("card-data-integrity: manifest <-> catalog", () => {
  test("every catalog id has exactly one coverage entry, and vice versa", () => {
    const missing = catalog
      .filter(c => !entryById.has(c.id))
      .map(c => `${c.name} (${c.id})`);
    const orphan = manifest.cards
      .filter(e => !catalogById.has(e.id))
      .map(e => `${e.name} (${e.id})`);
    assert.deepEqual(
      { missing, orphan },
      { missing: [], orphan: [] },
      "run: node scripts/build-coverage.cjs"
    );
    assert.equal(manifest.cards.length, catalog.length);
  });

  test("identity fields (set/type/name) agree between entry and card", () => {
    const mismatches: string[] = [];
    for (const e of manifest.cards) {
      const c = catalogById.get(e.id);
      if (!c) continue;
      if (c.set !== e.set || c.type !== e.type || c.name !== e.name) {
        mismatches.push(
          `${e.id}: entry(${e.name}/${e.set}/${e.type}) vs card(${c.name}/${c.set}/${c.type})`
        );
      }
    }
    assert.deepEqual(mismatches, [], "run: node scripts/build-coverage.cjs");
  });

  test("each entry's textHash matches the current printed text (stale => re-review)", () => {
    const stale = manifest.cards
      .filter(e => {
        const c = catalogById.get(e.id);
        return c && textHashOf(c.text) !== e.textHash;
      })
      .map(e => e.name);
    assert.deepEqual(
      stale,
      [],
      "card text changed since classification. Re-review, then: node scripts/build-coverage.cjs --accept-text <id>"
    );
  });

  test("every entry.status is a known status", () => {
    for (const e of manifest.cards) {
      assert.ok(
        STATUSES.includes(e.status),
        `${e.name}: unknown status ${JSON.stringify(e.status)}`
      );
    }
    assert.deepEqual(manifest.statuses, STATUSES);
  });

  test("every wontImplement entry explains why in `notes`", () => {
    const bad = manifest.cards
      .filter(e => e.status === "wontImplement")
      .filter(e => !e.notes || e.notes.trim().length < 10)
      .map(e => e.name);
    assert.deepEqual(
      bad,
      [],
      "a wontImplement entry must carry a `notes` saying which unmodellable mechanic it needs"
    );
  });
});

describe("card-data-integrity: authored behavior parses against the vocabulary", () => {
  const withBehavior = catalog.filter(c => c.behavior);

  test("behavior blocks round-trip through structuredClone", () => {
    for (const c of withBehavior) {
      assert.doesNotThrow(
        () => structuredClone(c.behavior),
        `${c.name}: behavior is not plain serializable data`
      );
    }
  });

  test("every `type:` tag in a behavior block is a known vocabulary tag", () => {
    const bad: string[] = [];
    for (const c of catalog) {
      const tags: string[] = [];
      // a faction card carries its abilities / start-of-turn effects under
      // `faction`, not `behavior` — vocab-check both.
      collectTypeTags(c.behavior, tags);
      collectTypeTags((c as { faction?: unknown }).faction, tags);
      for (const t of tags) {
        if (!KNOWN_TYPE_TAGS.has(t)) bad.push(`${c.name}: unknown type "${t}"`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test("abilities are well-formed (id, discriminant, required arrays)", () => {
    const problems: string[] = [];
    for (const c of catalog) {
      const factionAbilities =
        (c as { faction?: { abilities?: Array<Record<string, unknown>> } })
          .faction?.abilities ?? [];
      const abilities = [...(c.behavior?.abilities ?? []), ...factionAbilities];
      if (abilities.length === 0) continue;
      const seenIds = new Set<string>();
      for (const a of abilities) {
        const id = a.id as string | undefined;
        const type = a.type as string | undefined;
        if (!id || typeof id !== "string")
          problems.push(`${c.name}: ability with no string id`);
        else if (seenIds.has(id))
          problems.push(`${c.name}: duplicate ability id "${id}"`);
        else seenIds.add(id);

        if (!type || !ABILITY_TYPES.has(type)) {
          problems.push(`${c.name}: ability "${id}" has bad type ${JSON.stringify(type)}`);
          continue;
        }
        if (type === "triggered") {
          const ev = a.event as string | undefined;
          if (!ev || !EVENT_TYPES.has(ev))
            problems.push(`${c.name}: triggered ability "${id}" bad event ${JSON.stringify(ev)}`);
          if (!Array.isArray(a.effects))
            problems.push(`${c.name}: triggered ability "${id}" missing effects[]`);
        }
        if (type === "activated" && !Array.isArray(a.effects))
          problems.push(`${c.name}: activated ability "${id}" missing effects[]`);
        if (type === "continuous" && !Array.isArray(a.modifiers))
          problems.push(`${c.name}: continuous ability "${id}" missing modifiers[]`);
        if (type === "replacement") {
          if (!a.replaces || typeof a.replaces !== "object")
            problems.push(`${c.name}: replacement ability "${id}" missing replaces`);
          if (!Array.isArray(a.effects))
            problems.push(`${c.name}: replacement ability "${id}" missing effects[]`);
        }
      }
      for (const kw of c.behavior?.keywords ?? []) {
        if (!KEYWORDS.has(kw)) problems.push(`${c.name}: unknown keyword "${kw}"`);
      }
    }
    assert.deepEqual(problems, []);
  });
});

describe("card-data-integrity: coverage invariants", () => {
  test("capabilities map is well-formed", () => {
    for (const [id, cap] of Object.entries(manifest.capabilities)) {
      assert.ok(
        ["unimplemented", "designed", "implemented"].includes(cap.status),
        `capability ${id}: bad status ${JSON.stringify(cap.status)}`
      );
      assert.ok(cap.spec && cap.spec.trim().length > 0, `capability ${id}: empty spec`);
      assert.ok(Array.isArray(cap.kind), `capability ${id}: kind must be an array`);
    }
  });

  test("one-pass invariant: authored/verified => no unimplemented engine capability", () => {
    const violations: string[] = [];
    for (const e of manifest.cards) {
      if (e.status !== "authored" && e.status !== "verified") continue;
      for (const capId of e.engineCapability) {
        const cap = manifest.capabilities[capId];
        if (!cap) {
          violations.push(`${e.name}: references unknown capability "${capId}"`);
        } else if (cap.status !== "implemented") {
          violations.push(
            `${e.name}: status ${e.status} but capability "${capId}" is ${cap.status}`
          );
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  test("authored/verified => declared metadata is actually present on the card", () => {
    const violations: string[] = [];
    for (const e of manifest.cards) {
      if (e.status !== "authored" && e.status !== "verified") continue;
      const c = catalogById.get(e.id);
      if (!c) continue;
      if (e.metadata.attachTo && c.attachTo !== e.metadata.attachTo)
        violations.push(`${e.name}: metadata.attachTo=${e.metadata.attachTo} but card.attachTo=${c.attachTo}`);
      if (e.metadata.unique && c.unique !== e.metadata.unique)
        violations.push(`${e.name}: metadata.unique=${e.metadata.unique} but card.unique=${c.unique}`);
      if (
        e.metadata.resourceProvides &&
        JSON.stringify(c.resource?.provides ?? null) !==
          JSON.stringify(e.metadata.resourceProvides)
      )
        violations.push(`${e.name}: metadata.resourceProvides mismatch`);
    }
    assert.deepEqual(violations, []);
  });

  test("metadata already on a catalog card is reflected in its manifest entry (catalog -> manifest, one way)", () => {
    // The reverse (manifest declares metadata the card lacks) is legitimate
    // before authoring — the manifest records the INTENT ahead of Phase 3 —
    // and is checked for authored/verified entries by the test above.
    const drift: string[] = [];
    for (const c of catalog) {
      const e = entryById.get(c.id);
      if (!e) continue;
      if (c.attachTo && e.metadata.attachTo !== c.attachTo)
        drift.push(`${c.name}: card.attachTo=${c.attachTo} not recorded in manifest`);
      if (c.unique && e.metadata.unique !== c.unique)
        drift.push(`${c.name}: card.unique=${c.unique} not recorded in manifest`);
      if (
        c.resource?.provides &&
        JSON.stringify(e.metadata.resourceProvides) !==
          JSON.stringify(c.resource.provides)
      )
        drift.push(`${c.name}: card.resource.provides not recorded in manifest`);
    }
    assert.deepEqual(drift, [], "run: node scripts/build-coverage.cjs");
  });

  test("authored/verified + reusesProvenShape === false => a card-behaviors.test.ts case names the card", () => {
    // Only bites once a card is actually authored; a classified/blocked card
    // may plan for a new test that doesn't exist yet.
    const missing = manifest.cards
      .filter(e => e.status === "authored" || e.status === "verified")
      .filter(e => e.behavior.reusesProvenShape === false)
      .filter(e => !behaviorsTestSrc.includes(e.name))
      .map(e => e.name);
    assert.deepEqual(
      missing,
      [],
      "an authored card flagged as a NEW ability shape needs its own describe() in card-behaviors.test.ts"
    );
  });
});

describe("card-data-integrity: parity gaps", () => {
  const gaps = manifest.parityGaps ?? {};
  const SCOPES = new Set(["medium", "large", "xlarge"]);

  test("every parityGaps entry is well-formed", () => {
    const problems: string[] = [];
    for (const [id, gap] of Object.entries(gaps)) {
      if (!gap.summary || gap.summary.trim().length < 10)
        problems.push(`${id}: missing/short summary`);
      if (!gap.needs || gap.needs.trim().length < 10)
        problems.push(`${id}: missing/short needs`);
      if (!SCOPES.has(gap.scope))
        problems.push(`${id}: bad scope ${JSON.stringify(gap.scope)}`);
    }
    assert.deepEqual(problems, []);
  });

  test("every card's parityGaps id resolves to a registered gap", () => {
    const bad: string[] = [];
    for (const e of manifest.cards) {
      for (const g of e.parityGaps ?? []) {
        if (!(g in gaps)) bad.push(`${e.name}: unknown parity gap "${g}"`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test("every registered gap is referenced by at least one card (no orphans)", () => {
    const referenced = new Set(
      manifest.cards.flatMap(e => e.parityGaps ?? [])
    );
    const orphans = Object.keys(gaps).filter(id => !referenced.has(id));
    assert.deepEqual(orphans, [], "prune an unused parityGaps entry or link a card");
  });

  test("a card with a parity gap is not left at `high` confidence unless the gap is only a secondary clause", () => {
    // Not enforced automatically — a `high` card with a parity gap must have
    // a note explaining the gap is a secondary clause. Just require the note.
    const bad = manifest.cards
      .filter(e => (e.parityGaps ?? []).length > 0 && e.confidence === "high")
      .filter(e => !/unmodelled|out of scope|Showdown|EPIC|card flip/i.test(e.notes || ""))
      .map(e => e.name);
    assert.deepEqual(
      bad,
      [],
      "a `high` card carrying a parity gap must note in `notes` why the gap is non-blocking"
    );
  });
});

describe("card-data-integrity: location structure", () => {
  // A location's damage capacity is `structure` (RULES.md §3); the state-based
  // check destroys it once `damage >= structure`. A location with no numeric
  // structure can never be destroyed by damage — a silent data gap, so make
  // it a loud one. (Historically 2 locations were missing this from the
  // source dump; the last, Zenobia's Tower, is filled by inference — see its
  // coverage-manifest note.)
  test("every location carries a numeric structure >= 0", () => {
    const bad = catalog
      .filter(c => c.type === "location")
      .filter(c => typeof c.structure !== "number" || c.structure < 0)
      .map(c => `${c.name} (${c.set}): structure=${JSON.stringify(c.structure)}`);
    assert.deepEqual(bad, []);
  });
});

describe("card-data-integrity: faction setup blocks", () => {
  test("every faction card carries a structurally complete `faction` block", () => {
    const problems: string[] = [];
    for (const c of catalog.filter(x => x.type === "faction")) {
      const f = c.faction as
        | { startingInfluence?: unknown; setup?: unknown; turn?: unknown }
        | undefined;
      if (!f) {
        problems.push(`${c.name}: no faction block`);
        continue;
      }
      if (typeof f.startingInfluence !== "number")
        problems.push(`${c.name}: faction.startingInfluence not a number`);
      if (!f.setup) problems.push(`${c.name}: faction.setup missing`);
      if (!f.turn) problems.push(`${c.name}: faction.turn missing`);
    }
    assert.deepEqual(problems, []);
  });
});
