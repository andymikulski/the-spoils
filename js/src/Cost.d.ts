import { NumberExpression, TargetRef, PlayerRef, CardSelector } from "./references_expressions_selectors.js";
export type Cost = {
    type: "payResources";
    amount: NumberExpression;
} | {
    type: "deplete";
    target: TargetRef;
} | {
    type: "discard";
    player: PlayerRef;
    selector: CardSelector;
    count: number;
} | {
    type: "destroy";
    target: TargetRef;
};
