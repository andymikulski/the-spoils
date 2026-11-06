#!/usr/bin/env node
/* build-coverage.cjs
 *
 * Maintains data/card-coverage.json — the per-card implementation checklist
 * that drives the "one pass" card-coverage effort (see BEHAVIORS.md ->
 * "Coverage workflow", and the plan at
 * ~/.claude/plans/delegated-mapping-nautilus.md).
 *
 * What it does:
 *   - Reads data/cards.json (the catalog) and the existing
 *     data/card-coverage.json (if any).
 *   - Adds a skeleton entry for every catalog id that doesn't have one yet
 *     (status "vanilla" for text-free / keyword-only cards, "unclassified"
 *     otherwise). NEVER advances an entry's status or rewrites its
 *     classification — humans/agents do that.
 *   - Prunes entries whose card id no longer exists (reported).
 *   - Leaves each existing entry's `textHash` untouched, so a later change
 *     to a card's printed text is caught by card-data-integrity.test.ts
 *     ("stale -> re-review") rather than silently accepted here.
 *   - Regenerates COVERAGE.md (human-readable status roll-up). Never
 *     hand-edit COVERAGE.md.
 *
 * Usage:
 *   node scripts/build-coverage.cjs           # update manifest + COVERAGE.md
 *   node scripts/build-coverage.cjs --check    # exit 1 if either would change
 *   node scripts/build-coverage.cjs --accept-text <cardId> [<cardId> ...]
 *                                             # bump those entries' textHash to
 *                                             # the current text (after re-review)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const CARDS_PATH = path.join(ROOT, "data", "cards.json");
const COVERAGE_PATH = path.join(ROOT, "data", "card-coverage.json");
const COVERAGE_MD_PATH = path.join(ROOT, "COVERAGE.md");
const FIDELITY_PATH = path.join(ROOT, "data", "card-fidelity.json");

// How faithfully the engine reproduces a card's printed text.
//   full    — every mechanically-meaningful clause is obeyed. Cosmetic-only
//             deviations don't count (a "reveal"/"look at" verb with no
//             downstream reference; "pick a player" collapsing to the sole
//             opponent in the 2-player engine).
//   partial — a documented concession changes how at least one line plays.
//             The card still resolves and is broadly usable.
//   stub    — the card's core function isn't modelled (⇔ status
//             "wontImplement").
const FIDELITIES = ["full", "partial", "stub"];
const defaultFidelity = status => (status === "wontImplement" ? "stub" : "full");

const STATUSES = [
  "unclassified",
  "vanilla",
  "classified",
  "authored",
  "verified",
  "blocked",
  // References a mechanic a 2-player, single-game engine can't model
  // (alternate win conditions, "outside the game", multiplayer/politics,
  // draft/format text). Carries a `notes` explaining why; counts as
  // resolved (not blocked) in COVERAGE.md.
  "wontImplement"
];

// Statuses that count as "no further work" for the % done roll-up.
const RESOLVED_STATUSES = ["vanilla", "verified", "wontImplement"];

// Printed text that needs no `behavior` beyond a bare keyword line.
const KEYWORD_ONLY_RE = /^(covert|aggro|tactical|redirect damage|[\s,.\-])+$/i;

function sha1(s) {
  return crypto.createHash("sha1").update(s, "utf8").digest("hex").slice(0, 12);
}

/** Normalize printed text before hashing so trivial whitespace churn is ignored. */
function textHashOf(card) {
  return sha1((card.text || "").replace(/\s+/g, " ").trim());
}

function isVanilla(card) {
  const t = (card.text || "").trim();
  if (card.type === "resource") return true;
  if (!t) return true;
  return KEYWORD_ONLY_RE.test(t);
}

function skeletonEntry(card) {
  const vanilla = isVanilla(card);
  return {
    id: card.id,
    name: card.name,
    set: card.set,
    type: card.type,
    status: vanilla ? "vanilla" : "unclassified",
    fidelity: "full",
    textHash: textHashOf(card),
    behavior: {
      // Default assumption until a human classifies: a non-vanilla card
      // needs a `behavior` block. Classification flips this to false for
      // cards that turn out to have no ability (incl. factions whose only
      // data is their `faction` setup block).
      needed: !vanilla,
      shapes: [],
      reusesProvenShape: null,
      newTestNeeded: false
    },
    // Set true once the card's `text` has actually been read against
    // RULES.md and its `behavior` (if any) confirmed correct — distinct
    // from "has a behavior block". Lets a review pass be tracked separately
    // from authoring.
    rulesAudited: false,
    metadata: {
      unique: card.unique ?? null,
      attachTo: card.attachTo ?? null,
      resourceProvides: card.resource?.provides ?? null,
      keywords: card.behavior?.keywords ?? []
    },
    engineCapability: [],
    display: {},
    confidence: null,
    notes: ""
  };
}

function loadJson(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function setSizes(cards) {
  const sizes = new Map();
  for (const c of cards) sizes.set(c.set, (sizes.get(c.set) || 0) + 1);
  return sizes;
}

/** Rollout order: smallest set first (see plan). */
function orderedSets(cards) {
  const sizes = setSizes(cards);
  return [...sizes.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([set]) => set);
}

function buildManifest(cards, prev) {
  const prevById = new Map((prev.cards || []).map(e => [e.id, e]));
  const liveIds = new Set(cards.map(c => c.id));
  const acceptText = new Set(
    process.argv.includes("--accept-text")
      ? process.argv.slice(process.argv.indexOf("--accept-text") + 1)
      : []
  );

  const pruned = (prev.cards || []).filter(e => !liveIds.has(e.id));

  const setRank = new Map(orderedSets(cards).map((s, i) => [s, i]));
  const entries = cards
    .map(card => {
      const existing = prevById.get(card.id);
      if (!existing) return skeletonEntry(card);
      // Keep human classification; refresh only the immutable identity fields.
      existing.name = card.name;
      existing.set = card.set;
      existing.type = card.type;
      // Backfill fields added to the schema after this entry was written.
      if (typeof existing.rulesAudited !== "boolean") existing.rulesAudited = false;
      if (!FIDELITIES.includes(existing.fidelity)) {
        existing.fidelity = defaultFidelity(existing.status);
      }
      // A wontImplement card is a stub by definition; keep the two in lockstep.
      if (existing.status === "wontImplement") existing.fidelity = "stub";
      else if (existing.fidelity === "stub") existing.fidelity = "full";
      if (acceptText.has(card.id)) existing.textHash = textHashOf(card);
      return existing;
    })
    .sort(
      (a, b) =>
        (setRank.get(a.set) ?? 99) - (setRank.get(b.set) ?? 99) ||
        a.name.localeCompare(b.name)
    );

  return {
    manifest: {
      $schema: "./card-coverage.schema (see BEHAVIORS.md -> Coverage workflow)",
      generatedBy: "scripts/build-coverage.cjs",
      note:
        "Source of truth for card implementation status. build-coverage.cjs only adds skeletons / prunes dead ids; it never advances status or edits classification.",
      statuses: STATUSES,
      capabilities: prev.capabilities || {},
      // Deliberately-unmodelled printed clauses that need a large engine /
      // format refactor. Hand-maintained; build-coverage preserves it
      // verbatim. See BEHAVIORS.md -> "Coverage workflow".
      parityGaps: prev.parityGaps || {},
      cards: entries
    },
    pruned
  };
}

function pct(n, d) {
  return d === 0 ? "100%" : `${Math.round((n / d) * 100)}%`;
}

function renderCoverageMd(manifest, cards) {
  const sets = orderedSets(cards);
  const bySet = new Map(sets.map(s => [s, []]));
  for (const e of manifest.cards) {
    if (!bySet.has(e.set)) bySet.set(e.set, []);
    bySet.get(e.set).push(e);
  }

  const lines = [];
  lines.push("# COVERAGE.md");
  lines.push("");
  lines.push(
    "**Generated by `scripts/build-coverage.cjs` — do not hand-edit.**  " +
      "Source of truth is `data/card-coverage.json`."
  );
  lines.push("");
  lines.push(
    "Card implementation status for the data-driven engine. Sets are listed " +
      "in rollout order (smallest first). See `BEHAVIORS.md` → \"Coverage " +
      "workflow\" for the schema and the one-pass process."
  );
  lines.push("");

  const zero = () => ({
    vanilla: 0, unclassified: 0, classified: 0, authored: 0,
    verified: 0, blocked: 0, wontImplement: 0
  });
  const resolvedOf = c => RESOLVED_STATUSES.reduce((n, s) => n + (c[s] || 0), 0);

  lines.push("## Status by set");
  lines.push("");
  lines.push(
    "| Set | Cards | vanilla | unclassified | classified | authored | verified | blocked | wontImpl | % done |"
  );
  lines.push("|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|");
  const totals = zero();
  for (const set of bySet.keys()) {
    const es = bySet.get(set);
    const c = zero();
    for (const e of es) c[e.status] = (c[e.status] || 0) + 1;
    for (const k of Object.keys(totals)) totals[k] += c[k];
    lines.push(
      `| ${set} | ${es.length} | ${c.vanilla} | ${c.unclassified} | ${c.classified} | ${c.authored} | ${c.verified} | ${c.blocked} | ${c.wontImplement} | ${pct(resolvedOf(c), es.length)} |`
    );
  }
  const allN = manifest.cards.length;
  lines.push(
    `| **Total** | **${allN}** | ${totals.vanilla} | ${totals.unclassified} | ${totals.classified} | ${totals.authored} | ${totals.verified} | ${totals.blocked} | ${totals.wontImplement} | ${pct(resolvedOf(totals), allN)} |`
  );
  lines.push("");
  lines.push(
    `_Rules-audited: ${manifest.cards.filter(e => e.rulesAudited).length}/${allN}._`
  );
  const fid = manifest.cards.reduce((acc, e) => {
    acc[e.fidelity] = (acc[e.fidelity] || 0) + 1;
    return acc;
  }, {});
  lines.push(
    `_Fidelity to printed text: ${fid.full || 0} full · ${fid.partial || 0} partial · ${fid.stub || 0} stub._`
  );
  lines.push("");

  lines.push("## Engine capability backlog");
  lines.push("");
  const caps = Object.entries(manifest.capabilities || {});
  if (caps.length === 0) {
    lines.push("_None flagged yet._");
  } else {
    lines.push("| Capability | Status | Kind | Cards | Spec |");
    lines.push("|---|---|---|--:|---|");
    for (const [id, cap] of caps.sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(
        `| \`${id}\` | ${cap.status || "?"} | ${(cap.kind || []).join(", ")} | ${(cap.cards || []).length} | ${(cap.spec || "").replace(/\n/g, " ")} |`
      );
    }
  }
  lines.push("");

  const gaps = Object.entries(manifest.parityGaps || {});
  if (gaps.length > 0) {
    lines.push("## Parity gaps");
    lines.push("");
    lines.push(
      "_Printed clauses deliberately left unmodelled — each needs a large " +
        "engine / format refactor. The affected cards are still `verified` " +
        "for their in-scope parts._"
    );
    lines.push("");
    lines.push("| Gap | Scope | Cards | Summary |");
    lines.push("|---|---|--:|---|");
    for (const [id, gap] of gaps.sort((a, b) => a[0].localeCompare(b[0]))) {
      const affected = manifest.cards.filter(e =>
        (e.parityGaps || []).includes(id)
      );
      lines.push(
        `| \`${id}\` | ${gap.scope || "?"} | ${affected.length} | ${(gap.summary || "").replace(/\n/g, " ")} |`
      );
    }
    lines.push("");
    for (const [id, gap] of gaps.sort((a, b) => a[0].localeCompare(b[0]))) {
      const affected = manifest.cards.filter(e =>
        (e.parityGaps || []).includes(id)
      );
      lines.push(`### \`${id}\``);
      lines.push("");
      if (gap.clause) lines.push(`- **Clause:** ${gap.clause.replace(/\n/g, " ")}`);
      if (gap.needs) lines.push(`- **Needs:** ${gap.needs.replace(/\n/g, " ")}`);
      lines.push(
        `- **Cards:** ${affected.map(e => `${e.name} (${e.set})`).join(", ") || "_none_"}`
      );
      lines.push("");
    }
  }

  const flag = (title, pred) => {
    const hits = manifest.cards.filter(pred);
    if (hits.length === 0) return;
    lines.push(`## ${title} (${hits.length})`);
    lines.push("");
    for (const e of hits) {
      lines.push(`- **${e.name}** (${e.set}) — ${e.notes || e.status}`);
    }
    lines.push("");
  };
  flag("Blocked", e => e.status === "blocked");
  flag("Won't implement", e => e.status === "wontImplement");
  flag("Partial fidelity", e => e.fidelity === "partial");
  flag(
    "Low confidence",
    e => e.confidence === "low" && e.status !== "verified"
  );

  return lines.join("\n");
}

function stableStringify(obj) {
  return JSON.stringify(obj, null, 2) + "\n";
}

/**
 * The lean, downstream-facing view of `fidelity`: a flat id -> level map
 * plus a `notes` sidecar for anything below `full`. Exported as
 * `CARD_FIDELITY` so a client can badge / gate decks. Regenerated here; never
 * hand-edited.
 */
function buildFidelity(manifest) {
  const fidelity = {};
  const notes = {};
  for (const e of manifest.cards) {
    fidelity[e.id] = e.fidelity;
    if (e.fidelity !== "full" && e.notes) notes[e.id] = e.notes.replace(/\s+/g, " ").trim();
  }
  return {
    generatedBy: "scripts/build-coverage.cjs",
    note:
      "How faithfully the engine reproduces each card's printed text. " +
      "full = every mechanically-meaningful clause obeyed; partial = a " +
      "documented concession changes a line; stub = core function unmodelled.",
    counts: manifest.cards.reduce((acc, e) => {
      acc[e.fidelity] = (acc[e.fidelity] || 0) + 1;
      return acc;
    }, {}),
    fidelity,
    notes
  };
}

function main() {
  const check = process.argv.includes("--check");
  const cards = loadJson(CARDS_PATH, null);
  if (!cards) {
    console.error("data/cards.json not found");
    process.exit(2);
  }
  const prev = loadJson(COVERAGE_PATH, {});
  const { manifest, pruned } = buildManifest(cards, prev);

  const nextManifestStr = stableStringify(manifest);
  const nextMdStr = renderCoverageMd(manifest, cards);
  const nextFidelityStr = stableStringify(buildFidelity(manifest));

  const curManifestStr = fs.existsSync(COVERAGE_PATH)
    ? fs.readFileSync(COVERAGE_PATH, "utf8")
    : "";
  const curMdStr = fs.existsSync(COVERAGE_MD_PATH)
    ? fs.readFileSync(COVERAGE_MD_PATH, "utf8")
    : "";
  const curFidelityStr = fs.existsSync(FIDELITY_PATH)
    ? fs.readFileSync(FIDELITY_PATH, "utf8")
    : "";

  const changed =
    nextManifestStr !== curManifestStr ||
    nextMdStr !== curMdStr ||
    nextFidelityStr !== curFidelityStr;

  if (pruned.length) {
    console.log(
      `Pruned ${pruned.length} entries for ids no longer in the catalog:`
    );
    for (const e of pruned) console.log(`  - ${e.name} (${e.id})`);
  }

  if (check) {
    if (changed) {
      console.error(
        "card-coverage.json / COVERAGE.md are stale — run: node scripts/build-coverage.cjs"
      );
      process.exit(1);
    }
    console.log("coverage manifest up to date");
    return;
  }

  fs.writeFileSync(COVERAGE_PATH, nextManifestStr);
  fs.writeFileSync(COVERAGE_MD_PATH, nextMdStr);
  fs.writeFileSync(FIDELITY_PATH, nextFidelityStr);

  const counts = manifest.cards.reduce((acc, e) => {
    acc[e.status] = (acc[e.status] || 0) + 1;
    return acc;
  }, {});
  console.log(
    `Wrote ${manifest.cards.length} entries -> data/card-coverage.json + COVERAGE.md`
  );
  console.log(
    "  " +
      STATUSES.map(s => `${s}: ${counts[s] || 0}`).join("  ")
  );
}

main();
