// Records the two-player replay corpus (data/replays/2p/), see docs/TESTING.md "Replay digests".
//
//   npm run record-replays                      # 120 games, in parallel workers
//   npm run record-replays -- --games 150 --jobs 8 --max-actions 700
//
// Slot g plays seeded random legal games (support/driver.ts) between decks built around faction
// printings and featured sets picked from g, so any large enough run covers every set and every
// full-fidelity faction. A seed that hits an engine finding (perform threw on an approved action, no
// legal action) or does not finish within --max-actions is skipped and listed in index.json; the slot
// moves on to the next seed. Each recorded game is replayed from its JSON before it is written.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digestState } from "../src/engine/__tests__/support/digest.js";
import {
  CATALOG,
  ELIGIBLE_FACTIONS,
  createEngine,
  SET_NAMES,
  definitionOf,
  playRandomGame,
  randomSetup,
  type Finding,
  type GameSetupInputs
} from "../src/engine/__tests__/support/driver.js";
import {
  REPLAY_FORMAT_VERSION,
  findRoundTripPoints,
  replayAgainstDigests,
  type ReplayFile
} from "../src/engine/__tests__/support/replay.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const OUT_DIR = path.join(path.dirname(SCRIPT_PATH), "..", "data", "replays", "2p");
const MAX_ATTEMPTS = 8;

interface Args {
  games: number;
  jobs: number;
  maxActions: number;
  worker?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { games: 120, jobs: Math.max(1, Math.min(os.cpus().length - 2, 12)), maxActions: 700 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = Number(argv[i + 1]);
    if (flag === "--games") args.games = value;
    else if (flag === "--jobs") args.jobs = value;
    else if (flag === "--max-actions") args.maxActions = value;
    else if (flag === "--worker") args.worker = value;
    else continue;
    i++;
  }
  return args;
}

const gameFile = (slot: number): string => path.join(OUT_DIR, `game-${String(slot).padStart(3, "0")}.json`);

/** Faction printings and featured sets for a slot: consecutive slots walk through all of them. */
function slotSetup(slot: number, seed: number): GameSetupInputs {
  const nf = ELIGIBLE_FACTIONS.length;
  const ns = SET_NAMES.length;
  return randomSetup(seed, {
    factions: [ELIGIBLE_FACTIONS[slot % nf], ELIGIBLE_FACTIONS[(slot + 13 + Math.floor(slot / nf)) % nf]],
    featuredSets: [SET_NAMES[slot % ns], SET_NAMES[(slot * 5 + 3 + Math.floor(slot / ns)) % ns]]
  });
}

function format(file: ReplayFile): string {
  const { actions, ...rest } = file;
  const head = JSON.stringify(rest).slice(0, -1);
  return `${head},"actions":[\n${actions.map(action => JSON.stringify(action)).join(",\n")}\n]}\n`;
}

interface Skipped {
  slot: number;
  seed: number;
  reason: "finding" | "capped" | "replayMismatch";
  finding?: Finding;
  detail?: string;
}

interface RoundTripFailure {
  slot: number;
  seed: number;
  /** Actions performed when the game was saved. */
  savedAfter: number;
  /** Action count at which the loaded game first differed from the recording. */
  failedAt: number;
  action?: unknown;
  error: string;
}

interface SlotResult {
  slot: number;
  roundTripFailures: RoundTripFailure[];
  file?: { name: string; bytes: number; actions: number; status: string; turns: number };
  skipped: Skipped[];
}

function recordSlot(slot: number, maxActions: number): SlotResult {
  const skipped: Skipped[] = [];
  const roundTripFailures: RoundTripFailure[] = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const seed = slot * 100 + attempt + 1;
    const driverSeed = Math.imul(seed, 2654435761) >>> 0;
    // Play from the setup exactly as it will be read back from disk.
    const setup: GameSetupInputs = JSON.parse(JSON.stringify(slotSetup(slot, seed)));
    const digests: string[] = [];
    let setupDigest = "";
    const result = playRandomGame(setup, driverSeed, {
      maxActions,
      onAction: engine => digests.push(digestState(engine.state))
    });
    if (result.status === "finding") {
      skipped.push({ slot, seed, reason: "finding", finding: result.finding });
      continue;
    }
    if (result.status === "capped") {
      skipped.push({ slot, seed, reason: "capped", detail: `${result.actions.length} actions, turn ${result.turns}` });
      continue;
    }

    // The setup digest comes from a fresh build of the same inputs.
    const probe: ReplayFile = {
      formatVersion: REPLAY_FORMAT_VERSION,
      slot,
      driverSeed,
      status: "gameOver",
      ...(result.winner ? { winner: result.winner } : {}),
      turns: result.turns,
      setup,
      actions: result.actions,
      roundTripAfter: [],
      digests: ""
    };
    setupDigest = digestOfSetup(setup);
    probe.digests = [setupDigest, ...digests].join("");
    const file: ReplayFile = JSON.parse(JSON.stringify(probe));
    const total = file.actions.length;
    const search = findRoundTripPoints(file, [Math.floor(total / 4), Math.floor(total / 2), Math.floor((total * 3) / 4)]);
    file.roundTripAfter = search.points;
    for (const failure of search.failures) {
      roundTripFailures.push({
        slot,
        seed,
        savedAfter: failure.index,
        failedAt: failure.mismatch.index,
        action: failure.mismatch.action,
        error: failure.mismatch.error ?? "digest differs"
      });
    }
    const mismatch = replayAgainstDigests(file, { roundTripAfter: file.roundTripAfter });
    if (mismatch) {
      skipped.push({
        slot,
        seed,
        reason: "replayMismatch",
        detail: `index ${mismatch.index}: expected ${mismatch.expected}, got ${mismatch.actual}${mismatch.error ? ` (${mismatch.error})` : ""}`
      });
      continue;
    }

    const text = format(file);
    fs.writeFileSync(gameFile(slot), text);
    return {
      slot,
      file: { name: path.basename(gameFile(slot)), bytes: Buffer.byteLength(text), actions: file.actions.length, status: file.status, turns: file.turns },
      roundTripFailures,
      skipped
    };
  }
  return { slot, roundTripFailures, skipped };
}

function digestOfSetup(setup: GameSetupInputs): string {
  return digestState(createEngine(setup).state);
}

function runWorker(args: Args): void {
  const results: SlotResult[] = [];
  for (let slot = args.worker!; slot < args.games; slot += args.jobs) {
    const started = Date.now();
    const result = recordSlot(slot, args.maxActions);
    results.push(result);
    process.stderr.write(
      `slot ${slot}: ${result.file ? `${result.file.actions} actions, ${result.file.turns} turns` : "NOT RECORDED"}` +
        `${result.skipped.length ? `, ${result.skipped.length} skipped` : ""} (${((Date.now() - started) / 1000).toFixed(1)}s)\n`
    );
  }
  process.stdout.write(`RESULT ${JSON.stringify(results)}\n`);
}

async function runAll(args: Args): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const name of fs.readdirSync(OUT_DIR)) {
    if (/^game-\d+\.json$/.test(name) || name === "index.json") fs.rmSync(path.join(OUT_DIR, name));
  }

  const scriptPath = SCRIPT_PATH;
  const outputs = await Promise.all(
    Array.from({ length: args.jobs }, (_, worker) =>
      new Promise<string>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ["--import", "tsx", scriptPath, "--games", String(args.games), "--jobs", String(args.jobs), "--max-actions", String(args.maxActions), "--worker", String(worker)],
          { stdio: ["ignore", "pipe", "inherit"] }
        );
        let out = "";
        child.stdout.on("data", chunk => (out += chunk));
        child.on("exit", code => (code === 0 ? resolve(out) : reject(new Error(`worker ${worker} exited with ${code}`))));
      })
    )
  );

  const results: SlotResult[] = outputs
    .flatMap(out => out.split("\n").filter(line => line.startsWith("RESULT ")))
    .flatMap(line => JSON.parse(line.slice("RESULT ".length)) as SlotResult[])
    .sort((a, b) => a.slot - b.slot);

  const recorded = results.filter(result => result.file);
  const files = recorded.map(result => JSON.parse(fs.readFileSync(gameFile(result.slot), "utf8")) as ReplayFile);

  const setsSeen = new Map<string, number>();
  const factionsSeen = new Map<string, number>();
  for (const file of files) {
    for (const player of file.setup.players) {
      const faction = definitionOf(player.deck.factionDefinitionId);
      factionsSeen.set(`${faction.name} (${faction.set})`, (factionsSeen.get(`${faction.name} (${faction.set})`) ?? 0) + 1);
      for (const set of new Set(player.deck.cards.map(([id]) => definitionOf(id).set))) {
        setsSeen.set(set, (setsSeen.get(set) ?? 0) + 1);
      }
    }
  }
  const missingSets = SET_NAMES.filter(name => !setsSeen.has(name));
  const missingFactions = ELIGIBLE_FACTIONS.map(f => `${f.name} (${f.set})`).filter(name => !factionsSeen.has(name));

  const totalBytes = recorded.reduce((sum, result) => sum + result.file!.bytes, 0);
  const totalActions = recorded.reduce((sum, result) => sum + result.file!.actions, 0);
  const index = {
    generatedBy: "scripts/record-replays.ts",
    catalogPrintings: CATALOG.length,
    requestedGames: args.games,
    recordedGames: recorded.length,
    maxActions: args.maxActions,
    totalActions,
    totalBytes,
    winners: Object.fromEntries(
      ["p1", "p2", "draw"].map(w => [w, files.filter(file => (file.winner ?? "") === w).length])
    ),
    setsSeen: Object.fromEntries([...setsSeen].sort()),
    factionsSeen: Object.fromEntries([...factionsSeen].sort()),
    missingSets,
    missingFactions,
    skipped: results.flatMap(result => result.skipped),
    roundTripFailures: results.flatMap(result => result.roundTripFailures)
  };
  fs.writeFileSync(path.join(OUT_DIR, "index.json"), `${JSON.stringify(index, null, 2)}\n`);

  console.log(
    `recorded ${recorded.length}/${args.games} games, ${totalActions} actions, ${(totalBytes / 1e6).toFixed(2)} MB, ` +
      `${index.skipped.length} seeds skipped; missing sets: ${missingSets.join(", ") || "none"}; missing factions: ${missingFactions.join(", ") || "none"}`
  );
}

const args = parseArgs(process.argv.slice(2));
if (args.worker !== undefined) runWorker(args);
else void runAll(args);
