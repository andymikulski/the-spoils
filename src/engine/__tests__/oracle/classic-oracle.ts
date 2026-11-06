// Classic 2-player regression oracle.
//
// Plays a fixed set of seeded, real-catalog 2-player games to completion with
// the random self-play driver (support/autoplay.ts) and reduces each run to a
// STABLE PROJECTION: the actions the policy performed, the public game log,
// per-turn {influence, zone-size} snapshots, and the winner as a plain string.
// The projection deliberately avoids raw GameState shape so the engine can
// grow new state (formats, turn order, per-player flags, a GameResult winner)
// without invalidating the recording -- only an actual change in classic
// 2-player BEHAVIOR changes it.
//
// ADAPTING AFTER A REFACTOR (everything engine-shape-specific is in the three
// functions marked "ADAPT HERE" below; nothing else in this file reads
// GameState or calls a setup function):
//   1. buildClassicGame()  -- game construction (setup function + its options)
//   2. readWinner()        -- the final winner as "<playerId>" | "draw"
//   3. readPlayerSnapshot() / readTurnHeader() -- the per-turn state counters
// The playGameToCompletion driver (support/autoplay.ts) is also coupled to the
// engine (it reads state.result / flow.result); it is
// shared with full-game.test.ts and must keep producing the same decisions.
//
// Determinism: engine randomness comes from `options.seed` (GameState.rngState,
// see engine/rng.ts); the policy's own randomness from mulberry32(seed ^ 0x5eed).
// Decks are built from the real catalog with a seeded RNG, so a game is a pure
// function of its OracleGameSpec and the catalog. Changing data/cards.json
// (card behavior or text) legitimately changes the recording.

import { createHash } from "node:crypto";
import { CARD_CATALOG } from "../../../data.js";
import {
  type CardDefinition,
  type CardDefinitionId,
  type GameAction,
  type PlayerId,
  type SpoilsEngine,
  createFactionGame
} from "../../../engine.js";
import { playGameToCompletion } from "../support/autoplay.js";
import { mulberry32 } from "../support/prng.js";

// ---------------------------------------------------------------------------
// Game specs
// ---------------------------------------------------------------------------

type Trade = "arcanist" | "banker" | "gearsmith" | "rogue" | "warlord";

interface SeatSpec {
  /** Faction card, as "<name>|<set>" (resolved against the catalog). */
  faction: string;
  /** The two trades the deck is built from (plus universal cards). Must include any trade the faction's starting resources name. */
  trades: [Trade, Trade];
}

export interface OracleGameSpec {
  /** Stable label shown in failures and stored in the snapshot file. */
  label: string;
  /** Seeds the engine RNG, the deck builder and the policy. */
  seed: number;
  a: SeatSpec;
  b: SeatSpec;
  /** Seat that takes the first turn. */
  first: "a" | "b";
  /** Policy reserve (see AutoplayOptions.reserve); 0 for games with The Knitting Coalition, whose opponent can only develop through a paid ability. */
  reserve?: number;
  /** Store the full projection (not just hashes) in the snapshot file, so a failure can show the exact differing line. */
  keepFull?: boolean;
}

const STAPLE_NAME: Record<Trade, string> = {
  arcanist: "Obsession",
  banker: "Greed",
  gearsmith: "Elitism",
  rogue: "Deception",
  warlord: "Rage"
};

// Factions without a satisfiable-by-construction setup are left out:
// The Society of Magical Propriety needs a 300-card deck and The Open R&D
// Faction needs a created-ability spec.
const TOURNEY_OB: SeatSpec = { faction: "The Tournament Faction|Open Beta", trades: ["arcanist", "warlord"] };
const TOURNEY_SAGA: SeatSpec = { faction: "The Tournament Faction|Seed Saga", trades: ["banker", "rogue"] };
const TOURNEY_SEED: SeatSpec = { faction: "The Tournament Faction|Seed", trades: ["gearsmith", "arcanist"] };
const KNITTING: SeatSpec = { faction: "The Knitting Coalition|Seed 3", trades: ["banker", "rogue"] };
const UNION: SeatSpec = { faction: "The Union of Unextraordinary Miners|Seed 3", trades: ["rogue", "gearsmith"] };
const IMPERIAL: SeatSpec = { faction: "Imperial Army|Seed 3", trades: ["warlord", "gearsmith"] };
const COUNTER_IMPERIAL: SeatSpec = { faction: "Counter-Imperial Army|Seed 3", trades: ["warlord", "rogue"] };
const EVIL: SeatSpec = { faction: "The Evil Alliance|Seed 3", trades: ["rogue", "banker"] };
const LESS_EVIL: SeatSpec = { faction: "Slightly Less Evil Alliance|Seed 3", trades: ["arcanist", "banker"] };
const HALL: SeatSpec = { faction: "Hall of Great Justice|Seed", trades: ["warlord", "banker"] };
const CATACOMBS: SeatSpec = { faction: "Drowned Catacombs|Seed", trades: ["rogue", "arcanist"] };
const GOLDEN_STRING: SeatSpec = { faction: "Order of the Golden String|Seed Saga", trades: ["banker", "gearsmith"] };
const WEIRDOS: SeatSpec = { faction: "Alliance of Handy Weirdos|Seed Saga", trades: ["gearsmith", "warlord"] };
const MOIST_CAVE: SeatSpec = { faction: "Moist Cave of the Darkpump|Seed Saga", trades: ["arcanist", "rogue"] };
const LEGIONS: SeatSpec = { faction: "Legions of Chaos|Seed Saga", trades: ["warlord", "arcanist"] };
const UNLIKELY: SeatSpec = { faction: "Unlikely Heroes|Holy Heist", trades: ["banker", "warlord"] };
const MARDUUN: SeatSpec = { faction: "Defenders of Marduun|Seed Saga", trades: ["gearsmith", "rogue"] };
const LUGUBRIAN: SeatSpec = { faction: "Lugubrian Council Expedition Division|Holy Heist", trades: ["arcanist", "gearsmith"] };
const TRIBES: SeatSpec = { faction: "The Primitive Tribes of Thabbash|Holy Heist", trades: ["arcanist", "banker"] };

const MATCHUPS: Array<{ name: string; a: SeatSpec; b: SeatSpec; seeds: number[] }> = [
  { name: "tournament-vs-tournament", a: TOURNEY_OB, b: TOURNEY_SAGA, seeds: [101, 102, 103] },
  { name: "knitting-vs-imperial", a: KNITTING, b: IMPERIAL, seeds: [201, 202, 203] },
  { name: "union-vs-knitting", a: UNION, b: KNITTING, seeds: [301, 302, 303] },
  { name: "tournament-vs-union", a: TOURNEY_SEED, b: UNION, seeds: [401, 402, 403] },
  { name: "evil-vs-lessevil", a: EVIL, b: LESS_EVIL, seeds: [501, 502] },
  { name: "hall-vs-catacombs", a: HALL, b: CATACOMBS, seeds: [601, 602, 603] },
  { name: "goldenstring-vs-weirdos", a: GOLDEN_STRING, b: WEIRDOS, seeds: [701, 702] },
  { name: "moistcave-vs-legions", a: MOIST_CAVE, b: LEGIONS, seeds: [801, 802, 803] },
  { name: "unlikely-vs-marduun", a: UNLIKELY, b: MARDUUN, seeds: [901, 902] },
  { name: "lugubrian-vs-tribes", a: LUGUBRIAN, b: TRIBES, seeds: [1001, 1002] },
  { name: "counterimperial-vs-union", a: COUNTER_IMPERIAL, b: UNION, seeds: [1101, 1102] },
  { name: "knitting-vs-tournament", a: KNITTING, b: TOURNEY_OB, seeds: [1201, 1202, 1203] }
];

/** Seeds whose full projection is stored in the snapshot file (debuggable diffs): one Knitting game, one Union game, one plain one. */
const KEEP_FULL = new Set([102, 301, 403, 601]);

export const ORACLE_GAMES: OracleGameSpec[] = MATCHUPS.flatMap(({ name, a, b, seeds }) =>
  seeds.map((seed, i): OracleGameSpec => ({
    label: `${name}#${seed}`,
    seed,
    a,
    b,
    first: i % 2 === 0 ? "a" : "b",
    ...(a === KNITTING || b === KNITTING ? { reserve: 0 } : {}),
    keepFull: KEEP_FULL.has(seed)
  }))
);

// ---------------------------------------------------------------------------
// Deck building (real catalog, seeded)
// ---------------------------------------------------------------------------

const BY_ID = new Map(CARD_CATALOG.map(card => [card.id, card] as const));

function findCard(name: string, set: string, type?: string): CardDefinition {
  const card = CARD_CATALOG.find(c => c.name === name && c.set === set && (!type || c.type === type));
  if (!card) throw new Error(`Oracle: catalog has no '${name}' in '${set}'.`);
  return card;
}

function shuffledCopy<T>(items: readonly T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const STAPLES_PER_TRADE = 7;
const NONSTAPLE_CARDS = 46;
const MAX_CARD_COST = 5;
/** Safety cap: a game that needs more engine actions than this is a stuck policy/engine, not a game. */
const MAX_ACTIONS = 6000;

/** A fixed-size, copy-limit-respecting deck: the faction card, 7 staples of each of the two trades, then ~46 cheap cards of those trades (or universal), drawn 3 characters : 2 others. */
function buildDeck(seat: SeatSpec, rng: () => number): { factionId: CardDefinitionId; deckIds: CardDefinitionId[] } {
  const [factionName, factionSet] = seat.faction.split("|");
  const faction = findCard(factionName, factionSet, "faction");
  const deckIds: CardDefinitionId[] = [faction.id];

  for (const trade of seat.trades) {
    const staple = findCard(STAPLE_NAME[trade], "Open Beta", "resource");
    for (let i = 0; i < STAPLES_PER_TRADE; i++) deckIds.push(staple.id);
  }

  // Stable order before shuffling (catalog order is data-file order; sort so a reordered file still builds the same deck).
  const eligible = CARD_CATALOG.filter(
    card =>
      card.type !== "faction" &&
      card.type !== "resource" &&
      (seat.trades.includes(card.trade as Trade) || card.trade === "universal") &&
      card.cost <= MAX_CARD_COST
  ).sort((x, y) => (x.name + x.set + x.id < y.name + y.set + y.id ? -1 : 1));

  // One printing per name (copy limits count by name, CR 201.1b).
  const seenNames = new Set<string>();
  const byName = eligible.filter(card => !seenNames.has(card.name) && !!seenNames.add(card.name));
  const characters = shuffledCopy(byName.filter(c => c.type === "character"), rng);
  const others = shuffledCopy(byName.filter(c => c.type !== "character"), rng);

  let added = 0;
  let ci = 0;
  let oi = 0;
  for (let n = 0; added < NONSTAPLE_CARDS && (ci < characters.length || oi < others.length); n++) {
    const wantCharacter = (n % 5 < 3 && ci < characters.length) || oi >= others.length;
    const card = wantCharacter ? characters[ci++] : others[oi++];
    const copies = Math.min(card.deckLimit === "unlimited" ? 3 : 4, 2 + Math.floor(rng() * 2), NONSTAPLE_CARDS - added);
    for (let i = 0; i < copies; i++) deckIds.push(card.id);
    added += copies;
  }

  return { factionId: faction.id, deckIds };
}

/** The definitions a game needs: every deck card plus the other face of any double-sided faction. */
function definitionsFor(deckIds: CardDefinitionId[][]): CardDefinition[] {
  const needed = new Set<CardDefinitionId>(deckIds.flat());
  for (const id of [...needed]) {
    const flips = BY_ID.get(id)?.faction?.flipsTo;
    if (flips) needed.add(flips);
  }
  return [...needed].map(id => BY_ID.get(id)!);
}

// ---------------------------------------------------------------------------
// ADAPT HERE (1/3): game construction
// ---------------------------------------------------------------------------

const PLAYER_A: PlayerId = "a" as PlayerId;
const PLAYER_B: PlayerId = "b" as PlayerId;

/**
 * Builds the engine for a classic 2-player game. This is the ONLY place that
 * calls a setup function. Post-refactor, change this to
 * `createFactionGame(defs, [seatA, seatB], options)` (same decks, same seed,
 * same first player, same Union `startingResourceX`).
 */
function buildClassicGame(
  definitions: CardDefinition[],
  seatA: { factionId: CardDefinitionId; deckIds: CardDefinitionId[] },
  seatB: { factionId: CardDefinitionId; deckIds: CardDefinitionId[] },
  options: { seed: number; firstPlayerId: PlayerId; startingResourceX?: Record<PlayerId, number> }
): SpoilsEngine {
  return createFactionGame(
    definitions,
    [
      { id: PLAYER_A, name: "Player A", factionDefinitionId: seatA.factionId, deckDefinitionIds: seatA.deckIds },
      { id: PLAYER_B, name: "Player B", factionDefinitionId: seatB.factionId, deckDefinitionIds: seatB.deckIds }
    ],
    options
  );
}

// ---------------------------------------------------------------------------
// ADAPT HERE (2/3): the winner
// ---------------------------------------------------------------------------

/**
 * The finished game's winner as a plain string: a player id, or "draw".
 * Maps `GameState.result` back to the recorded strings (a single winner ->
 * that player's id, a draw -> "draw").
 */
function readWinner(engine: SpoilsEngine): string {
  const result = engine.state.result;
  if (result === undefined) return "none";
  return result.outcome === "draw" ? "draw" : result.winners.join("+");
}

// ---------------------------------------------------------------------------
// ADAPT HERE (3/3): per-turn state counters
// ---------------------------------------------------------------------------

/** `turn=<n> active=<id>` -- where the game is. */
function readTurnHeader(engine: SpoilsEngine): string {
  return `turn=${engine.state.turn} active=${String(engine.state.activePlayerId)}`;
}

/** One compact line per player: influence and zone sizes. Seat order is the creation order (a, b). */
function readPlayerSnapshot(engine: SpoilsEngine): string[] {
  return Object.values(engine.state.players).map(
    p =>
      `${String(p.id)}: inf=${p.influence} hand=${p.hand.length} deck=${p.deck.length} ` +
      `discard=${p.discard.length} play=${p.play.length}`
  );
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export interface OracleTurn {
  /** `GameState.turn` while these actions were performed (setup counts as its own leading entry). */
  turn: number;
  /** State when the turn's first action was about to be performed. */
  snapshot: string[];
  /** Actions the policy performed, compactly stringified. */
  actions: string[];
  /** Public game-log lines recorded during the turn: "<depth>|<kind>|<message>". */
  log: string[];
}

export interface OracleProjection {
  label: string;
  winner: string;
  /** Total actions the policy performed. */
  actionCount: number;
  turns: OracleTurn[];
  /** Header + player lines once the game was over. */
  final: string[];
}

/** Key-sorted JSON with undefined dropped: a stable one-line form of an action. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([x], [y]) => (x < y ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Seeded Union of Unextraordinary Miners "choose a number for X" (a no-op for every other faction). */
function startingResourceXFor(spec: OracleGameSpec): Record<PlayerId, number> {
  return { [PLAYER_A]: 1 + (spec.seed % 4), [PLAYER_B]: 2 + (spec.seed % 3) } as Record<PlayerId, number>;
}

/** Builds the engine for a spec: seeded decks from the real catalog, set up through to the first mulligan. */
export function buildOracleEngine(spec: OracleGameSpec): SpoilsEngine {
  const rngDeck = mulberry32(spec.seed ^ 0xdec4);
  const seatA = buildDeck(spec.a, rngDeck);
  const seatB = buildDeck(spec.b, rngDeck);

  return buildClassicGame(definitionsFor([seatA.deckIds, seatB.deckIds]), seatA, seatB, {
    seed: spec.seed,
    firstPlayerId: spec.first === "a" ? PLAYER_A : PLAYER_B,
    startingResourceX: startingResourceXFor(spec)
  });
}

export function runClassicGame(spec: OracleGameSpec): OracleProjection {
  const engine = buildOracleEngine(spec);

  // Record every real action. The driver's legality probes run on separate
  // throwaway engines, so only committed actions pass through this wrapper.
  const turns: OracleTurn[] = [];
  const turnByNumber = new Map<number, OracleTurn>();
  let actionCount = 0;
  let depth = 0;
  const perform = engine.perform.bind(engine);
  engine.perform = (action: GameAction): void => {
    if (depth === 0) {
      const turn = engine.state.turn;
      let entry = turnByNumber.get(turn);
      if (!entry) {
        entry = { turn, snapshot: [readTurnHeader(engine), ...readPlayerSnapshot(engine)], actions: [], log: [] };
        turnByNumber.set(turn, entry);
        turns.push(entry);
      }
      entry.actions.push(stableStringify(action));      actionCount++;
    }
    depth++;
    try {
      perform(action);
    } finally {
      depth--;
    }
  };

  try {
    playGameToCompletion(engine, { botRandom: mulberry32(spec.seed ^ 0x5eed), maxActions: MAX_ACTIONS, reserve: spec.reserve });
  } catch (error) {
    const last = turns[turns.length - 1];
    throw new Error(
      `${spec.label}: ${(error as Error).message}\nlast actions:\n  ${last?.actions.slice(-6).join("\n  ")}\n` +
        `flow: ${JSON.stringify(engine.getFlowView()).slice(0, 800)}\n` +
        `last log:\n  ${engine.getLog().slice(-4).map(e => e.message).join("\n  ")}`
    );
  }

  for (const entry of engine.getLog()) {
    let turn = turnByNumber.get(entry.turn);
    if (!turn) {
      turn = { turn: entry.turn, snapshot: [], actions: [], log: [] };
      turnByNumber.set(entry.turn, turn);
      turns.push(turn);
    }
    turn.log.push(`${entry.depth}|${entry.kind}|${entry.message}`);
  }
  turns.sort((x, y) => x.turn - y.turn);

  return {
    label: spec.label,
    winner: readWinner(engine),
    actionCount,
    turns,
    final: [readTurnHeader(engine), ...readPlayerSnapshot(engine)]
  };
}

// ---------------------------------------------------------------------------
// Snapshot digests and diffing
// ---------------------------------------------------------------------------

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

/** One seed's entry in classic-oracle.snapshots.json. */
export interface OracleSnapshot {
  label: string;
  winner: string;
  actionCount: number;
  logLines: number;
  /** sha256 of the whole projection. */
  sha256: string;
  /** sha256 of each turn (first 16 hex chars), to localise a divergence without storing the game. */
  turnSha: string[];
  /** The whole projection, for a few seeds only. */
  full?: OracleProjection;
}

export function digestProjection(projection: OracleProjection, keepFull: boolean): OracleSnapshot {
  return {
    label: projection.label,
    winner: projection.winner,
    actionCount: projection.actionCount,
    logLines: projection.turns.reduce((n, t) => n + t.log.length, 0),
    sha256: sha(JSON.stringify(projection)),
    turnSha: projection.turns.map(t => sha(JSON.stringify(t)).slice(0, 16)),
    ...(keepFull ? { full: projection } : {})
  };
}

function firstLineDifference(expected: string[], actual: string[]): string {
  const n = Math.max(expected.length, actual.length);
  for (let i = 0; i < n; i++) {
    if (expected[i] !== actual[i]) {
      return `line ${i}:\n      expected: ${expected[i] ?? "<end>"}\n      actual:   ${actual[i] ?? "<end>"}`;
    }
  }
  return "(identical)";
}

/** Human-readable description of the first difference between a recording and a fresh run, or null when they match. */
export function describeDivergence(
  expected: OracleSnapshot,
  actual: OracleProjection
): string | null {
  const got = digestProjection(actual, false);
  if (got.sha256 === expected.sha256) return null;

  const lines: string[] = [`${expected.label}: classic 2-player behavior changed.`];
  if (got.winner !== expected.winner) lines.push(`  winner: expected ${expected.winner}, got ${got.winner}`);
  if (got.actionCount !== expected.actionCount) {
    lines.push(`  action count: expected ${expected.actionCount}, got ${got.actionCount}`);
  }

  const turnIndex = (() => {
    const n = Math.max(got.turnSha.length, expected.turnSha.length);
    for (let i = 0; i < n; i++) if (got.turnSha[i] !== expected.turnSha[i]) return i;
    return -1;
  })();

  if (turnIndex === -1) {
    lines.push("  per-turn contents are identical; only the winner/final state/turn list differs.");
    return lines.join("\n");
  }

  const actualTurn = actual.turns[turnIndex];
  lines.push(`  first differing turn: index ${turnIndex} (GameState.turn ${actualTurn?.turn ?? "<missing>"})`);
  const expectedTurn = expected.full?.turns[turnIndex];
  if (expectedTurn && actualTurn) {
    if (expectedTurn.snapshot.join("\n") !== actualTurn.snapshot.join("\n")) {
      lines.push(`  snapshot at turn start:\n    ${firstLineDifference(expectedTurn.snapshot, actualTurn.snapshot)}`);
    }
    if (expectedTurn.actions.join("\n") !== actualTurn.actions.join("\n")) {
      lines.push(`  first differing action:\n    ${firstLineDifference(expectedTurn.actions, actualTurn.actions)}`);
    }
    if (expectedTurn.log.join("\n") !== actualTurn.log.join("\n")) {
      lines.push(`  first differing log line:\n    ${firstLineDifference(expectedTurn.log, actualTurn.log)}`);
    }
  } else if (actualTurn) {
    lines.push(
      "  (no full recording stored for this seed; the actual turn starts:)",
      ...actualTurn.snapshot.map(s => `    ${s}`),
      ...actualTurn.actions.slice(0, 3).map(a => `    action ${a}`),
      ...actualTurn.log.slice(0, 5).map(l => `    log ${l}`),
      "  Temporarily set the seed in KEEP_FULL (classic-oracle.ts), re-record, and diff the JSON for the exact line."
    );
  }
  lines.push("  If this change to classic behavior is INTENDED, re-record: npx tsx scripts/record-classic-oracle.ts");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// On-disk form (written by scripts/record-classic-oracle.ts)
// ---------------------------------------------------------------------------

export interface StoredSnapshot {
  meta: Omit<OracleSnapshot, "turnSha" | "full">;
  turnSha: string[];
  full?: { head: Omit<OracleProjection, "turns">; turns: OracleTurn[] };
}

export function fromStored(stored: StoredSnapshot): OracleSnapshot {
  return {
    ...stored.meta,
    turnSha: stored.turnSha,
    ...(stored.full ? { full: { ...stored.full.head, turns: stored.full.turns } } : {})
  };
}

/** The seat specs and deck builder, for the multiplayer fuzz games (src/engine/__tests__/multiplayer/fuzz.test.ts). */
export const ORACLE_SEATS = { TOURNEY_OB, TOURNEY_SAGA, TOURNEY_SEED, KNITTING, UNION, IMPERIAL, COUNTER_IMPERIAL, EVIL, LESS_EVIL, HALL, CATACOMBS, GOLDEN_STRING, WEIRDOS, MOIST_CAVE, LEGIONS, UNLIKELY, MARDUUN, LUGUBRIAN, TRIBES };
export { buildDeck as buildOracleDeck, definitionsFor as oracleDefinitionsFor, findCard as findOracleCard };
export type { SeatSpec as OracleSeatSpec };
