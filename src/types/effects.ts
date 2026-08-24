// -----------------------------------------------------------------------------
// Effects
// -----------------------------------------------------------------------------

import type { Duration, ModifierOperation, Stat, Zone } from "./ids.js";
import type { NumberExpression, PlayerRef, TargetRef } from "./expressions.js";

export type Effect =
  | {
      type: "draw";
      player: PlayerRef;
      amount: NumberExpression;
    }
  | {
      /**
       * Play a selected card as a resource. "auto" plays actual resource
       * cards face-up and all other cards face-down.
       */
      type: "playResource";
      target: TargetRef;
      faceDown: boolean | "auto";
    }
  | {
      type: "dealDamage";
      target: TargetRef;
      amount: NumberExpression;
    }
  | {
      type: "modifyInfluence";
      player: PlayerRef;
      amount: NumberExpression;
    }
  | {
      type: "moveCard";
      target: TargetRef;
      to: Zone;
    }
  | {
      type: "destroy";
      target: TargetRef;
    }
  | {
      type: "deplete";
      target: TargetRef;
    }
  | {
      type: "restore";
      target: TargetRef;
    }
  | {
      type: "addCounter";
      target: TargetRef;
      counter: string;
      amount: NumberExpression;
    }
  | {
      type: "removeCounter";
      target: TargetRef;
      counter: string;
      amount: NumberExpression;
    }
  | {
      type: "createModifier";
      target: TargetRef;
      stat: Stat;
      operation: ModifierOperation;
      value: NumberExpression;
      duration: Duration;
    }
  | {
      /** Changes who controls an in-play card (e.g. "take control of the location"). */
      type: "takeControl";
      target: TargetRef;
      controller: PlayerRef;
    }
  | {
      /** "Remove from the game" (RULES.md §2) — permanent, unlike moveCard to any tracked zone. */
      type: "removeFromGame";
      target: TargetRef;
    };

export interface ModifierDefinition {
  target: TargetRef;
  stat: Stat;
  operation: ModifierOperation;
  value: NumberExpression;
}
