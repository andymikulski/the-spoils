export type PlayerId = string;
export type CardDefinitionId = string;
export type CardInstanceId = string;
export type AbilityId = string;
export type ModifierId = string;
export type BattleId = string;
export type Trade = "rage" | "greed" | "deception" | "elitism" | "obsession";
export type CardType = "character" | "item" | "location" | "tactic" | "resource" | "faction";
export type Zone = "deck" | "hand" | "deploying" | "play" | "discard" | "void";
export type Stat = "strength" | "life" | "speed" | "influence";
export type ComparisonOperator = ">" | ">=" | "=" | "<=" | "<";
export type Duration = {
    type: "permanent";
} | {
    type: "untilEndOfTurn";
} | {
    type: "whileSourceInPlay";
};
export type ModifierOperation = "add" | "set" | "multiply";
