import { SpoilsEngine } from "./engine.js";
import { createCardInstance, createTwoPlayerGame } from "./game-setup-helpers.js";
// -----------------------------------------------------------------------------
// Example JSON-safe card definitions
// -----------------------------------------------------------------------------
export const EXAMPLE_CARDS = [
    {
        id: "rage-brute",
        name: "Rage Brute",
        type: "character",
        cost: 3,
        threshold: {
            rage: 1,
        },
        stats: {
            strength: 4,
            life: 3,
            speed: 2,
        },
    },
    {
        id: "vengeful-thug",
        name: "Vengeful Thug",
        type: "character",
        cost: 4,
        threshold: {
            rage: 2,
        },
        stats: {
            strength: 4,
            life: 3,
            speed: 3,
        },
        abilities: [
            {
                id: "death-loss",
                type: "triggered",
                event: "cardDestroyed",
                condition: {
                    type: "sourceIsEventCard",
                },
                effects: [
                    {
                        type: "modifyInfluence",
                        player: "opponent",
                        amount: -4,
                    },
                ],
            },
        ],
    },
    {
        id: "rage-channeler",
        name: "Rage Channeler",
        type: "character",
        cost: 2,
        stats: {
            strength: 2,
            life: 3,
            speed: 2,
        },
        abilities: [
            {
                id: "pump",
                type: "activated",
                costs: [
                    {
                        type: "payResources",
                        amount: 1,
                    },
                    {
                        type: "deplete",
                        target: "source",
                    },
                ],
                targets: [
                    {
                        id: "target",
                        count: 1,
                        selector: {
                            controller: "self",
                            zone: "play",
                            type: "character",
                        },
                    },
                ],
                effects: [
                    {
                        type: "createModifier",
                        target: {
                            type: "selected",
                            id: "target",
                        },
                        stat: "strength",
                        operation: "add",
                        value: 2,
                        duration: {
                            type: "untilEndOfTurn",
                        },
                    },
                ],
            },
        ],
    },
    {
        id: "battle-cry",
        name: "Battle Cry",
        type: "tactic",
        cost: 1,
        abilities: [
            {
                id: "spell",
                type: "activated",
                targets: [
                    {
                        id: "target",
                        count: 1,
                        selector: {
                            controller: "self",
                            zone: "play",
                            type: "character",
                        },
                    },
                ],
                effects: [
                    {
                        type: "createModifier",
                        target: {
                            type: "selected",
                            id: "target",
                        },
                        stat: "strength",
                        operation: "add",
                        value: 3,
                        duration: {
                            type: "untilEndOfTurn",
                        },
                    },
                ],
            },
        ],
    },
];
// -----------------------------------------------------------------------------
// Tiny usage example
// -----------------------------------------------------------------------------
export function exampleGame() {
    const a1 = createCardInstance("rage-brute", "p1", "play");
    const a2 = createCardInstance("rage-channeler", "p1", "play");
    const tactic = createCardInstance("battle-cry", "p1", "hand");
    const b1 = createCardInstance("vengeful-thug", "p2", "play");
    const state = createTwoPlayerGame({
        id: "p1",
        name: "Player 1",
    }, {
        id: "p2",
        name: "Player 2",
    }, [a1, a2, tactic, b1]);
    state.players.p1.resources = 5;
    state.players.p1.thresholds.rage = 2;
    state.players.p2.resources = 5;
    state.players.p2.thresholds.rage = 2;
    return new SpoilsEngine(EXAMPLE_CARDS, state);
}
console.log("ok");
const game = exampleGame();
const channeler = Object.values(game.state.cards).find((card) => card.definitionId === "rage-channeler");
const brute = Object.values(game.state.cards).find((card) => card.definitionId === "rage-brute");
game.perform({
    type: "activateAbility",
    playerId: "p1",
    cardId: channeler.id,
    abilityId: "pump",
    selected: {
        target: [brute.id],
    },
});
// Opponent passes, controller passes. Top of stack resolves.
game.perform({
    type: "passPriority",
    playerId: "p2",
});
game.perform({
    type: "passPriority",
    playerId: "p1",
});
console.log(game.getStat(brute.id, "strength")); // 6
