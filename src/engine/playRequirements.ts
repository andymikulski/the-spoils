// Read-only client queries: "what does this play still need from the player?"
//
// The types and the pure helper behind `SpoilsEngine.getPlayRequirements` / `getSelectionRequirements`
// (see BEHAVIORS.md, "Read-only queries for clients"). The queries themselves live on the engine,
// because they call the same private logic `perform()` validates a play with.

import type {
  CardInstanceId,
  CardSelector,
  Cost,
  GameAction,
  NumberExpression,
  PlayerId,
  ResolutionContext,
  TargetDeclaration
} from "../types/index.js";
import { declinedKey } from "./utilities.js";

/** A play, an ability use or a FLIP UP: the three actions that carry picks, costs and chosen numbers. */
export type PlayAction = Extract<GameAction, { type: "playCard" | "activateAbility" | "flipUp" }>;

/** One thing the player must pick before the action can be dispatched: a targeting declaration, or a cost step that takes cards. */
export interface DeclarationRequirement {
  id: string;
  selector: CardSelector;
  /** Exact count required (or the max, when `optional`), evaluated by the engine. */
  count: number;
  optional: boolean;
  /** "N cards with different names" (`TargetDeclaration.distinctNames`). */
  distinctNames: boolean;
  /** Same, by printed trade (`distinctTrades`); set only when the declaration carries it. */
  distinctTrades?: boolean;
  /** Same, by card type (`distinctTypes`); set only when the declaration carries it. */
  distinctTypes?: boolean;
  /** "Pick 2 characters" written as two single-pick declarations: a card picked under one flagged declaration is not offered under the other. */
  distinctPicks?: boolean;
  /** The card never says "pick": a mandatory pick with no more candidates than `count` needs no input. */
  impliedPick?: boolean;
  /** Where this pick came from: a targeting declaration, a `discard` cost, or a `moveSelected` cost. */
  source: "target" | "discardCost" | "moveCost";
  /** For a cost-sourced pick: what the cost does with the cards, as a verb phrase ("discard", "shuffle into your deck"). */
  costLabel?: string;
  /** A `pick` cost step puts this pick after earlier cost steps: its legal cards are judged after them (`getPickCandidates`). */
  afterCost?: boolean;
  /** An OPTIONAL deck search: it may be declined outright (`declinedKey`), which is different from searching and finding nothing. */
  declinable?: boolean;
}

/** One pick the player still has to make. */
export interface PickStep {
  kind: "pick";
  requirement: DeclarationRequirement;
  /** Exactly the cards the engine would accept for this pick right now (after earlier cost steps, minus cards a `distinctPicks` sibling already took). */
  candidates: CardInstanceId[];
  /** Cards the selector matches that may not be picked: show them greyed out. */
  blocked: CardInstanceId[];
  /** How many must be chosen (the engine's own minimum, fewer when fewer cards exist; `1` while a card that must be picked is on offer). */
  min: number;
  /** The most that may be chosen. */
  max: number;
  /**
   * Set when an EMPTY answer is also legal although `min` is above 0: the pick is "none, or between `min` and `max`"
   * (`TargetDeclaration.minCount` on an optional pick: "You may deplete 3 Micromajig tokens" is none or exactly 3,
   * never 1 or 2). Absent = the pick must have `min`..`max` cards.
   */
  orNone?: boolean;
  /** The pick may be declined outright: answer with `declined: true` (an optional search; no search, no shuffle). */
  declinable: boolean;
  /**
   * The answer is fixed: every candidate has to be taken (`min` equals the number of candidates) and no distinct
   * rule (names / trades / types) could still refuse them. A client may take `candidates` without asking. (A client
   * that wants the player to SEE what is greyed out first can also look at `blocked`.)
   */
  forced: boolean;
  /** No two picks may share a printed name. */
  distinctNames: boolean;
  /** No two picks may share a printed trade. */
  distinctTrades: boolean;
  /** No two picks may share a card type. */
  distinctTypes: boolean;
}

export type PlayRequirement =
  /** A modal card: send `mode`. Later requirements aren't listed until it's answered (targets and costs differ per mode). */
  | { kind: "mode"; options: Array<{ index: number; label: string }> }
  /** FLIP UP with 2+ options the player can use (a printed one plus a granted one): send `flipUpOption`. */
  | {
      kind: "flipUpOption";
      options: Array<{ index: number; cost: number; threshold: string | number; available: boolean; reason?: string }>;
    }
  /** "Choose a number for X": every id in `variables` must be sent (0 is legal; negative / fractional is refused). */
  | { kind: "variables"; variables: Array<{ id: string; min: number; max: number }> }
  | PickStep;

/** What a client sends back for one requirement. */
export type PlayAnswer =
  | { kind: "mode"; index: number }
  | { kind: "flipUpOption"; index: number }
  | { kind: "variables"; values: Record<string, number> }
  | { kind: "pick"; id: string; cardIds: CardInstanceId[]; declined?: boolean };

/** Input of `getSelectionRequirements`: the picks of a pending-choice sub-selection (`selectTargets`, `chooserSelectsTarget`, `useTargetAbility`), with no play to read them from. */
export interface SelectionRequirementsInput {
  sourceId: CardInstanceId;
  controllerId: PlayerId;
  /** Who is actually choosing (the controller, unless a chooser answers). */
  pickerId?: PlayerId;
  abilityId?: string;
  declarations: TargetDeclaration[];
  /** The cost steps that go with the declarations (`discard` / `moveSelected` take cards; a `pick` step places a declaration after earlier steps). */
  costs: Cost[];
  /** Picks already made. */
  selected: Record<string, CardInstanceId[]>;
  /** Variables already known (chosen numbers, settled rolls). */
  variables: Record<string, number>;
  /** `nameValue` answers already given. */
  named?: Record<string, string>;
  /**
   * The ability's own `variables` / `variableBounds` / `condition`, when the selection should also ask for the
   * numbers the player chooses ("choose a number for X"). Omit them and only picks are listed.
   */
  variableSource?: {
    variables?: Record<string, NumberExpression>;
    variableBounds?: Record<string, { min?: NumberExpression; max?: NumberExpression }>;
    condition?: unknown;
  };
  /**
   * The pending choice's own resolution context (`pending.context`) when the selection answers a prompt. The
   * selection is judged in it, exactly as the engine judges the answer: the triggering `event` ("a character with
   * less strength than THAT character had": Gosche's Restoration Fortress), the effect's earlier picks, and so on.
   * `sourceId` / `controllerId` / `abilityId` / `selected` / `variables` / `named` above take precedence, and a
   * `selected` entry in it for a declaration being asked is ignored (that pick is what is being asked).
   */
  context?: ResolutionContext;
  /**
   * The play (a card played, an ability used, a FLIP UP) these picks belong to, when it has not been dispatched
   * yet: `getPlaySelectionInput` sets it. The picks are then judged as the play judges them: the card being played
   * is Being Deployed (CR 604.1: never a candidate), and a pick written after a cost step (`pick` cost step) is
   * judged on the board after the earlier steps. Leave it out for a prompt's sub-selection.
   */
  play?: PlayAction;
}

/** The answer of `checkSelection`: `{ ok: true }`, or the engine's own refusal text. */
export type SelectionCheck = { ok: true } | { ok: false; error: string };

/** The action with one requirement's answer folded in (a new object; `action` is untouched). */
export function answerPlayRequirement(action: PlayAction, answer: PlayAnswer): PlayAction {
  switch (answer.kind) {
    case "mode":
      return action.type === "activateAbility" ? action : { ...action, mode: answer.index };
    case "flipUpOption":
      return action.type === "flipUp" ? { ...action, flipUpOption: answer.index } : action;
    case "variables":
      return { ...action, variables: { ...(action.variables ?? {}), ...answer.values } };
    case "pick": {
      const selected = { ...(action.selected ?? {}), [answer.id]: answer.declined ? [] : answer.cardIds };
      if (answer.declined) selected[declinedKey(answer.id)] = [];
      return { ...action, selected };
    }
  }
}
