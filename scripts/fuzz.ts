// Seat fuzz sweep, see docs/TESTING.md "Fuzz".
//
//   npm run fuzz                                          # seats 2-6, seeds 1-30, 1500 actions per game
//   npm run fuzz -- --seats 3,4 --seeds 100 --max-actions 3000
//   npm run fuzz -- --seats 5 --first 200 --seeds 20 --jobs 8
//   npm run fuzz -- --seats 4 --seed 17                   # one game, with the failing action printed in full
//
// Plays seeded random games with real catalog decks (support/driver.ts) and checks the table invariants after every
// action (support/fuzz.ts). Prints one line per failing game and a summary per seat count; exits 1 if any game fails.
// A game that reaches --max-actions is counted as capped, not as a failure.

import { spawn } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { fuzzGame, type FuzzResult } from "../src/engine/__tests__/support/fuzz.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

interface Args {
  seats: number[];
  first: number;
  seeds: number;
  maxActions: number;
  jobs: number;
  /** Worker mode: the `seats:seed` jobs this process runs. */
  work?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { seats: [2, 3, 4, 5, 6], first: 1, seeds: 30, maxActions: 1500, jobs: Math.max(1, Math.min(os.cpus().length - 2, 8)) };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1] ?? "";
    if (flag === "--seats") args.seats = value.split(",").map(Number);
    else if (flag === "--seeds") args.seeds = Number(value);
    else if (flag === "--first") args.first = Number(value);
    else if (flag === "--seed") {
      args.first = Number(value);
      args.seeds = 1;
    } else if (flag === "--max-actions") args.maxActions = Number(value);
    else if (flag === "--jobs") args.jobs = Number(value);
    else if (flag === "--work") args.work = value;
    else continue;
    i++;
  }
  if (args.seats.some(seats => !Number.isInteger(seats) || seats < 2 || seats > 6)) throw new Error("--seats takes seat counts from 2 to 6");
  return args;
}

const args = parseArgs(process.argv.slice(2));

function runJobs(jobs: Array<[number, number]>): FuzzResult[] {
  return jobs.map(([seats, seed]) => {
    try {
      return fuzzGame(seats, seed, { maxActions: args.maxActions });
    } catch (error) {
      return { seats, seed, status: "finding", actions: 0, turns: 0, eliminations: 0, finding: { kind: "queryThrew", seed, step: 0, mode: "?", error: String(error) } } as FuzzResult;
    }
  });
}

async function main(): Promise<void> {
  const jobs: Array<[number, number]> = [];
  for (let seed = args.first; seed < args.first + args.seeds; seed++) for (const seats of args.seats) jobs.push([seats, seed]);

  const results: FuzzResult[] = [];
  const started = Date.now();
  await Promise.all(
    Array.from({ length: Math.min(args.jobs, jobs.length) }, (_, worker) => {
      const mine = jobs.filter((_, index) => index % args.jobs === worker);
      return new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ["--import", "tsx", SCRIPT_PATH, "--max-actions", String(args.maxActions), "--work", mine.map(([seats, seed]) => `${seats}:${seed}`).join(",")],
          { stdio: ["ignore", "pipe", "inherit"] }
        );
        let buffer = "";
        child.stdout.on("data", chunk => {
          buffer += chunk;
          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            results.push(JSON.parse(buffer.slice(0, newline)) as FuzzResult);
            buffer = buffer.slice(newline + 1);
          }
        });
        child.on("exit", code => (code === 0 ? resolve() : reject(new Error(`worker ${worker} exited with ${code}`))));
      });
    })
  );

  results.sort((a, b) => a.seats - b.seats || a.seed - b.seed);
  let failures = 0;
  for (const seats of args.seats) {
    const mine = results.filter(result => result.seats === seats);
    const count = (status: FuzzResult["status"]) => mine.filter(result => result.status === status).length;
    const failing = mine.filter(result => result.status === "finding" || result.status === "violation");
    failures += failing.length;
    console.log(
      `${seats} seats: ${mine.length} games, ${count("gameOver")} finished, ${count("capped")} capped, ${failing.length} failed,` +
        ` ${mine.filter(result => result.eliminations > 0).length} with an elimination mid-game` +
        ` (${mine.reduce((sum, result) => sum + result.actions, 0)} actions)`
    );
    for (const result of failing) {
      if (result.violation) {
        const { invariant, message, step, action } = result.violation;
        console.log(`  seed ${result.seed}: ${invariant} at step ${step}: ${message}`);
        if (args.seeds === 1) console.log(`    action: ${JSON.stringify(action)}`);
      } else if (result.finding) {
        const { kind, step, mode, error, detail, action } = result.finding;
        console.log(`  seed ${result.seed}: ${kind} at step ${step} (${mode}): ${error ?? ""} ${detail ?? ""}`);
        if (args.seeds === 1 && action) console.log(`    action: ${JSON.stringify(action)}`);
      }
    }
  }
  console.log(`${results.length} games in ${Math.round((Date.now() - started) / 1000)}s`);
  process.exit(failures > 0 ? 1 : 0);
}

if (args.work !== undefined) {
  for (const result of runJobs(args.work.split(",").map(job => job.split(":").map(Number) as [number, number]))) {
    process.stdout.write(JSON.stringify(result) + "\n");
  }
} else {
  void main();
}
