/* spoils-engine.ts
 *
 * Barebones, interface-first, data-driven rules engine for The Spoils.
 *
 * Goals:
 * - Card behavior is JSON-serializable.
 * - Cards never execute arbitrary callbacks.
 * - The engine owns mutation.
 * - Abilities are built from reusable costs, conditions, selectors, expressions, and effects.
 * - Triggered abilities react to engine events.
 * - Continuous abilities generate derived modifiers.
 * - Activated abilities and deployed cards can live on a response stack.
 *
 * This is intentionally UI-free. A UI can inspect GameState and submit GameAction objects.
 */
import cardsJson from "./data/cards.js";
// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------
let nextIdCounter = 1;
function nextId(prefix) {
    return `${prefix}_${nextIdCounter++}`;
}
function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}
function compare(left, op, right) {
    switch (op) {
        case ">":
            return left > right;
        case ">=":
            return left >= right;
        case "=":
            return left === right;
        case "<=":
            return left <= right;
        case "<":
            return left < right;
    }
}
export function parseThreshold(threshold) {
    var _a, _b, _c, _d, _e, _f;
    if (!threshold || threshold === 0) {
        return {};
    }
    const result = {};
    for (const icon of String(threshold).toLowerCase()) {
        switch (icon) {
            case "r":
                result.rage = ((_a = result.rage) !== null && _a !== void 0 ? _a : 0) + 1;
                break;
            case "g":
                result.greed = ((_b = result.greed) !== null && _b !== void 0 ? _b : 0) + 1;
                break;
            case "d":
                result.deception = ((_c = result.deception) !== null && _c !== void 0 ? _c : 0) + 1;
                break;
            case "e":
                result.elitism = ((_d = result.elitism) !== null && _d !== void 0 ? _d : 0) + 1;
                break;
            case "o":
                result.obsession = ((_e = result.obsession) !== null && _e !== void 0 ? _e : 0) + 1;
                break;
            case "v":
                result.volition = ((_f = result.volition) !== null && _f !== void 0 ? _f : 0) + 1;
                break;
            default:
                throw new Error(`Unknown threshold icon '${icon}'.`);
        }
    }
    return result;
}
export const TOURNAMENT_FACTION_DEFAULTS = {
    startingInfluence: 25,
    setup: {
        startingResources: {
            count: 2,
            stapleOnly: true,
        },
        openingHand: {
            goingFirst: 8,
            goingSecond: 9,
        },
        mulligan: {
            count: 1,
            mode: "replaceAny",
        },
    },
    turn: {
        restore: {
            clearCharacterDamage: true,
            detachResources: true,
            restoreNonResources: true,
        },
        develop: {
            choices: [
                { type: "draw", count: 1 },
                { type: "playResource", count: 1 },
            ],
        },
    },
};
export const TOURNAMENT_FACTION_BEHAVIOR = {
    abilities: [
        {
            id: "tournament-draw",
            name: "Draw",
            type: "activated",
            costs: [{ type: "payResources", amount: 3 }],
            effects: [{ type: "draw", player: "controller", amount: 1 }],
        },
        {
            id: "tournament-resource",
            name: "Resource",
            type: "activated",
            costs: [{ type: "payResources", amount: 4 }],
            targets: [
                {
                    id: "resource",
                    count: 1,
                    selector: {
                        controller: "self",
                        zone: "hand",
                    },
                },
            ],
            effects: [
                {
                    type: "playResource",
                    target: { type: "selected", id: "resource" },
                    faceDown: "auto",
                },
            ],
        },
    ],
};
function withBuiltInFactionDefaults(definition) {
    var _a, _b;
    if (definition.type !== "faction" ||
        definition.name.toLowerCase() !== "the tournament faction") {
        return definition;
    }
    return {
        ...definition,
        faction: (_a = definition.faction) !== null && _a !== void 0 ? _a : structuredClone(TOURNAMENT_FACTION_DEFAULTS),
        behavior: (_b = definition.behavior) !== null && _b !== void 0 ? _b : structuredClone(TOURNAMENT_FACTION_BEHAVIOR),
    };
}
// -----------------------------------------------------------------------------
// Engine
// -----------------------------------------------------------------------------
export class SpoilsEngine {
    constructor(definitions, initialState) {
        var _a, _b, _c, _d, _e;
        var _f, _g, _h, _j;
        this.immediateQueue = [];
        /**
         * Event batches delay triggered-ability execution until a simultaneous group
         * of mutations is complete. Battle damage uses this so one damage event
         * cannot interrupt another member of the same speed group.
         */
        this.eventBatchDepth = 0;
        this.definitions = Object.fromEntries(definitions.map((def) => {
            const normalized = withBuiltInFactionDefaults(def);
            return [normalized.id, normalized];
        }));
        this.state = initialState;
        // Compatibility with states created by older versions of this monofile.
        (_a = (_f = this.state).responseStack) !== null && _a !== void 0 ? _a : (_f.responseStack = []);
        (_b = (_g = this.state).turnPhase) !== null && _b !== void 0 ? _b : (_g.turnPhase = "main");
        (_c = (_h = this.state).setup) !== null && _c !== void 0 ? _c : (_h.setup = { phase: "complete" });
        (_d = (_j = this.state).started) !== null && _d !== void 0 ? _d : (_j.started = true);
        for (const card of Object.values(this.state.cards)) {
            (_e = card.faceDown) !== null && _e !== void 0 ? _e : (card.faceDown = false);
        }
    }
    get responseStack() {
        return this.state.responseStack;
    }
    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------
    perform(action) {
        if (this.state.setup.phase === "mulligan" && action.type !== "mulligan") {
            throw new Error("Opening mulligans must be completed before play begins.");
        }
        switch (action.type) {
            case "playCard":
                this.playCard(action);
                return;
            case "activateAbility":
                this.activateAbility(action);
                return;
            case "passPriority":
                this.passPriority(action.playerId);
                return;
            case "mulligan":
                this.mulligan(action.playerId, action.cardIds);
                return;
            case "chooseDevelop":
                this.chooseDevelop(action.playerId, action.choice);
                return;
            case "endTurn":
                this.endTurn(action.playerId);
                return;
            case "declareAttack":
                this.declareAttack(action.playerId, action.attackerIds, action.target);
                return;
            case "declareBlockers":
                this.declareBlockers(action.playerId, action.blockerIds);
                return;
            case "advanceFlow":
                this.advanceFlow();
                return;
            case "advanceBattle":
                assert(this.state.battle, "No battle in progress.");
                assert(action.playerId === this.state.battle.attackerPlayerId ||
                    action.playerId === this.state.battle.defenderPlayerId, "Player is not part of this battle.");
                this.advanceFlow();
                return;
            case "assignBattleDamage":
                this.assignBattleDamage(action.playerId, action.assignments);
                return;
        }
    }
    /**
     * Single query surface intended for a UI / renderer.
     */
    getFlowView() {
        var _a, _b, _c;
        let mode = this.state.turnPhase === "develop" ? "develop" : "main";
        if (this.state.setup.phase === "mulligan") {
            mode = "setup";
        }
        else if (((_a = this.state.responseWindow) === null || _a === void 0 ? void 0 : _a.phase) === "acceptingResponses") {
            mode = "response";
        }
        else if (((_b = this.state.responseWindow) === null || _b === void 0 ? void 0 : _b.phase) === "resolving") {
            mode = "resolvingResponses";
        }
        else if (((_c = this.state.battle) === null || _c === void 0 ? void 0 : _c.phase) === "finished") {
            mode = "battleFinished";
        }
        else if (this.state.battle) {
            mode = "battleChoice";
        }
        return {
            activePlayerId: this.state.activePlayerId,
            priorityPlayerId: this.state.priorityPlayerId,
            mode,
            turnPhase: this.state.turnPhase,
            setup: structuredClone(this.state.setup),
            responseWindow: this.state.responseWindow
                ? structuredClone(this.state.responseWindow)
                : undefined,
            responseStack: structuredClone(this.state.responseStack),
            battle: this.getBattleView(),
        };
    }
    getDefinition(cardId) {
        const card = this.requireCard(cardId);
        const definition = this.definitions[card.definitionId];
        assert(definition, `Missing definition '${card.definitionId}' for card '${cardId}'`);
        return definition;
    }
    getFactionCard(playerId) {
        const player = this.requirePlayer(playerId);
        return player.factionId ? this.state.cards[player.factionId] : undefined;
    }
    getFactionDefinition(playerId) {
        const faction = this.getFactionCard(playerId);
        if (!faction)
            return undefined;
        return this.getDefinition(faction.id).faction;
    }
    isResource(cardId) {
        const card = this.requireCard(cardId);
        return (card.zone === "play" &&
            (card.faceDown || this.getDefinition(cardId).type === "resource"));
    }
    getAvailableResourceIds(playerId) {
        const player = this.requirePlayer(playerId);
        return player.play.filter((cardId) => {
            const card = this.state.cards[cardId];
            return (card.controllerId === playerId &&
                this.isResource(cardId) &&
                card.attachedTo === undefined);
        });
    }
    getAvailableResourceCount(playerId) {
        return this.getAvailableResourceIds(playerId).length;
    }
    getThresholds(playerId) {
        var _a;
        const result = {};
        for (const cardId of this.requirePlayer(playerId).play) {
            const card = this.state.cards[cardId];
            if (!card || card.controllerId !== playerId || !this.isResource(cardId)) {
                continue;
            }
            const icons = this.getResourceIcons(cardId);
            for (const icon of icons) {
                result[icon] = ((_a = result[icon]) !== null && _a !== void 0 ? _a : 0) + 1;
            }
        }
        return result;
    }
    getDevelopChoices(playerId) {
        var _a;
        var _b;
        return structuredClone((_b = (_a = this.getFactionDefinition(playerId)) === null || _a === void 0 ? void 0 : _a.turn.develop.choices) !== null && _b !== void 0 ? _b : []);
    }
    getResourceIcons(cardId) {
        var _a, _b;
        const card = this.requireCard(cardId);
        if (card.faceDown) {
            return ["volition"];
        }
        const definition = this.getDefinition(cardId);
        if ((_b = (_a = definition.resource) === null || _a === void 0 ? void 0 : _a.provides) === null || _b === void 0 ? void 0 : _b.length) {
            return [...definition.resource.provides];
        }
        switch (definition.name.toLowerCase()) {
            case "rage":
                return ["rage"];
            case "greed":
                return ["greed"];
            case "deception":
                return ["deception"];
            case "elitism":
                return ["elitism"];
            case "obsession":
                return ["obsession"];
            default:
                return [];
        }
    }
    payNumericCost(playerId, amount) {
        assert(Number.isInteger(amount) && amount >= 0, "Numeric costs must be non-negative integers.");
        const player = this.requirePlayer(playerId);
        assert(player.factionId, "Player has no faction to attach resources to.");
        const resources = this.getAvailableResourceIds(playerId);
        assert(resources.length >= amount, "Not enough unattached resources.");
        for (const cardId of resources.slice(0, amount)) {
            this.requireCard(cardId).attachedTo = player.factionId;
        }
    }
    drawCards(playerId, amount) {
        const player = this.requirePlayer(playerId);
        const drawn = player.deck.splice(0, Math.max(0, amount));
        this.beginEventBatch();
        try {
            for (const cardId of drawn) {
                const card = this.requireCard(cardId);
                card.zone = "hand";
                card.faceDown = false;
                card.attachedTo = undefined;
                player.hand.push(cardId);
                this.emit({
                    type: "cardMoved",
                    cardId,
                    from: "deck",
                    to: "hand",
                });
            }
        }
        finally {
            this.endEventBatch();
        }
    }
    playResourceCard(playerId, cardId, faceDown) {
        const card = this.requireCard(cardId);
        const definition = this.getDefinition(cardId);
        assert(card.ownerId === playerId, "That card is not in this player's hand.");
        assert(card.zone === "hand", "A resource must be played from hand.");
        if (!faceDown) {
            assert(definition.type === "resource", "Only a resource card can be played face-up as a resource.");
        }
        card.faceDown = faceDown;
        card.attachedTo = undefined;
        this.moveCard(cardId, "play");
        this.emit({
            type: "resourcePlayed",
            cardId,
            playerId,
            faceDown,
        });
    }
    startGameAfterSetup() {
        assert(this.state.setup.phase === "complete", "Opening setup is not complete.");
        assert(!this.state.started, "The game has already started.");
        this.state.started = true;
        this.state.turnPhase = "develop";
        this.state.priorityPlayerId = this.state.activePlayerId;
        this.applyFactionStartOfTurn(this.state.activePlayerId);
        this.emit({
            type: "turnStarted",
            playerId: this.state.activePlayerId,
        });
    }
    mulligan(playerId, cardIds) {
        var _a;
        const setup = this.state.setup;
        assert(setup.phase === "mulligan", "The mulligan step is over.");
        assert(setup.order[setup.currentIndex] === playerId, "It is not this player's mulligan decision.");
        const faction = this.getFactionDefinition(playerId);
        const mulliganRule = faction === null || faction === void 0 ? void 0 : faction.setup.mulligan;
        assert((mulliganRule === null || mulliganRule === void 0 ? void 0 : mulliganRule.mode) === "replaceAny" && ((_a = mulliganRule.count) !== null && _a !== void 0 ? _a : 0) > 0, "This faction does not provide a replace-any mulligan.");
        const unique = new Set(cardIds);
        assert(unique.size === cardIds.length, "A mulligan card was selected twice.");
        const player = this.requirePlayer(playerId);
        for (const cardId of cardIds) {
            assert(player.hand.includes(cardId), "Mulligan cards must be in your hand.");
        }
        // Put the selected cards on the bottom in the supplied order, then draw
        // the same number. There is no shuffle during the Tournament mulligan.
        for (const cardId of cardIds) {
            player.hand = player.hand.filter((id) => id !== cardId);
            const card = this.requireCard(cardId);
            card.zone = "deck";
            player.deck.push(cardId);
        }
        this.drawCards(playerId, cardIds.length);
        setup.currentIndex++;
        if (setup.currentIndex >= setup.order.length) {
            this.state.setup = { phase: "complete" };
            this.startGameAfterSetup();
        }
    }
    chooseDevelop(playerId, choice) {
        assert(this.state.setup.phase === "complete", "Game setup is not complete.");
        assert(playerId === this.state.activePlayerId, "Only the active player develops.");
        assert(this.state.turnPhase === "develop", "The develop decision has already been made.");
        assert(!this.state.responseWindow && !this.state.battle, "Cannot develop during another flow.");
        const available = this.getDevelopChoices(playerId);
        const rule = available.find((candidate) => candidate.type === choice.type);
        assert(rule, `Faction does not allow develop choice '${choice.type}'.`);
        if (choice.type === "draw") {
            assert(rule.type === "draw", "Invalid draw develop rule.");
            this.drawCards(playerId, rule.count);
        }
        else {
            assert(rule.type === "playResource", "Invalid resource develop rule.");
            assert(choice.cards.length === rule.count, `Develop requires exactly ${rule.count} resource play(s).`);
            for (const resource of choice.cards) {
                this.playResourceCard(playerId, resource.cardId, resource.faceDown);
            }
        }
        this.state.turnPhase = "main";
        this.state.priorityPlayerId = playerId;
    }
    applyFactionStartOfTurn(playerId) {
        const player = this.requirePlayer(playerId);
        const faction = this.getFactionDefinition(playerId);
        const restore = faction === null || faction === void 0 ? void 0 : faction.turn.restore;
        // Start-of-turn attack eligibility is a core rule, not a faction ability.
        for (const card of Object.values(this.state.cards)) {
            card.attackEligibleTurn = undefined;
        }
        for (const cardId of player.play) {
            const card = this.requireCard(cardId);
            const definition = this.getDefinition(cardId);
            if (!card.faceDown &&
                definition.type === "character" &&
                card.controllerId === playerId) {
                card.attackEligibleTurn = this.state.turn;
            }
        }
        if (!restore)
            return;
        if (restore.clearCharacterDamage) {
            for (const card of Object.values(this.state.cards)) {
                if (card.zone === "play" &&
                    !card.faceDown &&
                    this.getDefinition(card.id).type === "character") {
                    card.damage = 0;
                }
            }
        }
        if (restore.detachResources && player.factionId) {
            for (const cardId of player.play) {
                const card = this.requireCard(cardId);
                if (card.attachedTo === player.factionId && this.isResource(cardId)) {
                    card.attachedTo = undefined;
                }
            }
        }
        if (restore.restoreNonResources) {
            for (const cardId of player.play) {
                if (!this.isResource(cardId)) {
                    this.requireCard(cardId).depleted = false;
                }
            }
        }
    }
    getStat(cardId, stat) {
        var _a, _b;
        const card = this.requireCard(cardId);
        const definition = this.getDefinition(cardId);
        let value = stat === "influence"
            ? ((_a = definition.influence) !== null && _a !== void 0 ? _a : 0)
            : ((_b = definition[stat]) !== null && _b !== void 0 ? _b : 0);
        const modifiers = [
            ...this.getContinuousModifiers(cardId),
            ...this.state.modifiers.filter((modifier) => modifier.targetId === cardId),
        ];
        for (const modifier of modifiers) {
            switch (modifier.operation) {
                case "add":
                    value += modifier.value;
                    break;
                case "set":
                    value = modifier.value;
                    break;
                case "multiply":
                    value *= modifier.value;
                    break;
            }
        }
        return value;
    }
    getAvailableActivatedAbilities(playerId) {
        var _a;
        var _b, _c;
        if (!this.canUseAbilityAtCurrentTiming(playerId)) {
            return [];
        }
        const result = [];
        for (const card of Object.values(this.state.cards)) {
            if (card.controllerId !== playerId ||
                card.zone !== "play" ||
                card.faceDown) {
                continue;
            }
            const definition = this.getDefinition(card.id);
            for (const ability of (_b = (_a = definition.behavior) === null || _a === void 0 ? void 0 : _a.abilities) !== null && _b !== void 0 ? _b : []) {
                if (ability.type !== "activated") {
                    continue;
                }
                const context = {
                    sourceId: card.id,
                    controllerId: playerId,
                    abilityId: ability.id,
                    selected: {},
                };
                if ((!ability.condition ||
                    this.evaluateCondition(ability.condition, context)) &&
                    this.canPayCosts((_c = ability.costs) !== null && _c !== void 0 ? _c : [], context)) {
                    result.push({
                        cardId: card.id,
                        ability,
                    });
                }
            }
        }
        return result;
    }
    queryCards(selector, context) {
        return Object.values(this.state.cards).filter((card) => this.matchesSelector(card, selector, context));
    }
    // ---------------------------------------------------------------------------
    // Card play / response stack
    // ---------------------------------------------------------------------------
    playCard(action) {
        var _a, _b;
        const card = this.requireCard(action.cardId);
        const definition = this.getDefinition(card.id);
        assert(card.controllerId === action.playerId, "You do not control that card.");
        assert(card.zone === "hand", "Card must be in your hand.");
        this.assertCanDeployAtCurrentTiming(action.playerId, definition);
        assert(this.meetsThreshold(action.playerId, definition.threshold), "Threshold requirements are not met.");
        const context = {
            sourceId: card.id,
            controllerId: action.playerId,
            selected: (_a = action.selected) !== null && _a !== void 0 ? _a : {},
        };
        this.validateTargetDeclarations(this.getPlayTargetDeclarations(definition), context);
        const resourceCost = (_b = definition.cost) !== null && _b !== void 0 ? _b : 0;
        assert(this.getAvailableResourceCount(action.playerId) >= resourceCost, "Not enough unattached resources.");
        this.payNumericCost(action.playerId, resourceCost);
        this.moveCard(card.id, "deploying");
        this.emit({
            type: "cardPlayed",
            cardId: card.id,
            playerId: action.playerId,
        });
        const effects = definition.type === "tactic" ? this.getTacticEffects(definition) : [];
        this.responseStack.push({
            id: nextId("stack"),
            sourceId: card.id,
            controllerId: action.playerId,
            kind: "card",
            effects,
            context,
        });
        this.afterStackAction(action.playerId);
    }
    getPlayTargetDeclarations(definition) {
        var _a, _b;
        var _c;
        if (definition.type !== "tactic") {
            return [];
        }
        // Barebones convention:
        // tactic cards use the first activated-ability-shaped behavior as the
        // instructions that resolve when the tactic finishes being deployed.
        const tacticAbility = (_b = (_a = definition.behavior) === null || _a === void 0 ? void 0 : _a.abilities) === null || _b === void 0 ? void 0 : _b.find((ability) => ability.type === "activated");
        return (_c = tacticAbility === null || tacticAbility === void 0 ? void 0 : tacticAbility.targets) !== null && _c !== void 0 ? _c : [];
    }
    getTacticEffects(definition) {
        var _a, _b;
        var _c;
        const tacticAbility = (_b = (_a = definition.behavior) === null || _a === void 0 ? void 0 : _a.abilities) === null || _b === void 0 ? void 0 : _b.find((ability) => ability.type === "activated");
        return (_c = tacticAbility === null || tacticAbility === void 0 ? void 0 : tacticAbility.effects) !== null && _c !== void 0 ? _c : [];
    }
    // ---------------------------------------------------------------------------
    // Activated abilities
    // ---------------------------------------------------------------------------
    activateAbility(action) {
        var _a, _b;
        var _c, _d, _e, _f;
        const card = this.requireCard(action.cardId);
        assert(card.zone === "play", "Source must be in play.");
        assert(card.controllerId === action.playerId, "You do not control that card.");
        this.assertCanUseAbilityAtCurrentTiming(action.playerId);
        const ability = (_b = (_a = this.getDefinition(card.id).behavior) === null || _a === void 0 ? void 0 : _a.abilities) === null || _b === void 0 ? void 0 : _b.find((ability) => ability.id === action.abilityId && ability.type === "activated");
        assert(ability, "Activated ability not found.");
        const context = {
            sourceId: card.id,
            controllerId: action.playerId,
            abilityId: ability.id,
            selected: (_c = action.selected) !== null && _c !== void 0 ? _c : {},
        };
        if (ability.condition) {
            assert(this.evaluateCondition(ability.condition, context), "Ability condition is not satisfied.");
        }
        this.validateTargetDeclarations((_d = ability.targets) !== null && _d !== void 0 ? _d : [], context);
        assert(this.canPayCosts((_e = ability.costs) !== null && _e !== void 0 ? _e : [], context), "Ability costs cannot be paid.");
        this.payCosts((_f = ability.costs) !== null && _f !== void 0 ? _f : [], context);
        // Cost-triggered abilities happen immediately before the ability itself
        // enters the response chain.
        this.processImmediateQueue();
        this.responseStack.push({
            id: nextId("stack"),
            sourceId: card.id,
            controllerId: action.playerId,
            kind: "ability",
            abilityId: ability.id,
            effects: ability.effects,
            context,
        });
        this.emit({
            type: "abilityActivated",
            cardId: card.id,
            abilityId: ability.id,
            playerId: action.playerId,
        });
        this.afterStackAction(action.playerId);
    }
    /**
     * Passing never resolves hidden work immediately. Two consecutive passes
     * switch the response window to "resolving". The renderer can animate that
     * transition and call advanceFlow() when it is ready for the next item.
     */
    passPriority(playerId) {
        const window = this.requireResponseWindow();
        assert(window.phase === "acceptingResponses", "Responses are currently resolving.");
        assert(window.priorityPlayerId === playerId, "It is not your priority.");
        window.consecutivePasses++;
        const opponent = this.getOpponent(playerId);
        window.priorityPlayerId = opponent.id;
        this.state.priorityPlayerId = opponent.id;
        if (window.consecutivePasses >= 2) {
            window.phase = "resolving";
        }
    }
    /**
     * Advances exactly one automatic step:
     *
     * 1. Resolve one response-stack item, OR
     * 2. Resume the interrupted turn/battle flow once the stack is empty, OR
     * 3. Clear a finished battle after the UI has had a chance to render it.
     */
    advanceFlow() {
        var _a;
        const window = this.state.responseWindow;
        if (window) {
            assert(window.phase === "resolving", "Players must finish responding before the flow can advance.");
            if (this.responseStack.length > 0) {
                this.resolveTopOfStack();
                return;
            }
            const continuation = structuredClone(window.continuation);
            this.state.responseWindow = undefined;
            this.state.priorityPlayerId = this.state.activePlayerId;
            this.resumeContinuation(continuation);
            return;
        }
        if (((_a = this.state.battle) === null || _a === void 0 ? void 0 : _a.phase) === "finished") {
            this.state.battle = undefined;
            this.state.priorityPlayerId = this.state.activePlayerId;
            return;
        }
        throw new Error("There is no automatic game-flow step to advance.");
    }
    resolveTopOfStack() {
        const item = this.responseStack.pop();
        assert(item, "Response stack is empty.");
        for (const effect of item.effects) {
            this.resolveEffect(effect, item.context);
            this.processImmediateQueue();
            this.checkStateBasedActions();
        }
        if (item.kind === "card") {
            const card = this.requireCard(item.sourceId);
            const definition = this.getDefinition(card.id);
            if (definition.type === "tactic") {
                if (card.zone === "deploying") {
                    this.moveCard(card.id, "discard");
                }
            }
            else if (card.zone === "deploying") {
                this.moveCard(card.id, "play");
                // A card entering during the active turn did not start that turn in
                // play, so it is not attack-eligible unless it has AGGRO.
                card.attackEligibleTurn = undefined;
                this.emit({
                    type: "cardEnteredPlay",
                    cardId: card.id,
                    playerId: card.controllerId,
                });
            }
        }
        this.processImmediateQueue();
        this.checkStateBasedActions();
    }
    afterStackAction(actingPlayerId) {
        const existing = this.state.responseWindow;
        if (existing) {
            assert(existing.phase === "acceptingResponses", "Cannot add a response while the chain is resolving.");
            existing.consecutivePasses = 0;
            existing.priorityPlayerId = this.getOpponent(actingPlayerId).id;
            this.state.priorityPlayerId = existing.priorityPlayerId;
            return;
        }
        this.openResponseWindow("action", this.getOpponent(actingPlayerId).id, {
            type: "main",
        });
    }
    openResponseWindow(kind, firstPlayerId, continuation) {
        assert(!this.state.responseWindow, "A response window is already open.");
        this.state.responseWindow = {
            id: nextId("response"),
            kind,
            phase: "acceptingResponses",
            firstPlayerId,
            priorityPlayerId: firstPlayerId,
            consecutivePasses: 0,
            continuation,
        };
        this.state.priorityPlayerId = firstPlayerId;
    }
    resumeContinuation(continuation) {
        switch (continuation.type) {
            case "main":
                this.state.priorityPlayerId = this.state.activePlayerId;
                return;
            case "endTurn":
                this.finishTurn(continuation.playerId);
                return;
            case "battleBlocking": {
                const battle = this.requireBattleId(continuation.battleId);
                battle.phase = "blocking";
                this.state.priorityPlayerId = battle.defenderPlayerId;
                return;
            }
            case "battleAssignDamage": {
                const battle = this.requireBattleId(continuation.battleId);
                this.enterDamageAssignment(battle);
                return;
            }
            case "battleInflictDamage": {
                const battle = this.requireBattleId(continuation.battleId);
                this.inflictLockedBattleDamage(battle);
                this.prepareNextSpeedGroupOrFinish(battle);
                return;
            }
        }
    }
    assertCanDeployAtCurrentTiming(playerId, definition) {
        const window = this.state.responseWindow;
        if (window) {
            assert(window.phase === "acceptingResponses", "Responses are already resolving.");
            assert(window.priorityPlayerId === playerId, "It is not your priority.");
            assert(definition.type === "tactic" ||
                this.definitionHasKeyword(definition, "tactical"), "Only tactics or TACTICAL cards may be deployed as responses.");
            return;
        }
        assert(!this.state.battle, "Cards may only be deployed during a battle in a response window.");
        assert(this.responseStack.length === 0, "Cannot begin a new action while responses are unresolved.");
        assert(playerId === this.state.activePlayerId, "Only the active player may deploy a normal turn action.");
        assert(this.state.turnPhase === "main", "Complete the faction's develop rule before taking normal turn actions.");
    }
    assertCanUseAbilityAtCurrentTiming(playerId) {
        assert(this.canUseAbilityAtCurrentTiming(playerId), "Ability cannot be used at the current timing.");
    }
    canUseAbilityAtCurrentTiming(playerId) {
        const window = this.state.responseWindow;
        if (window) {
            return (window.phase === "acceptingResponses" &&
                window.priorityPlayerId === playerId);
        }
        return (!this.state.battle &&
            this.responseStack.length === 0 &&
            playerId === this.state.activePlayerId &&
            this.state.turnPhase === "main");
    }
    requireResponseWindow() {
        const window = this.state.responseWindow;
        assert(window, "No response window is open.");
        return window;
    }
    // ---------------------------------------------------------------------------
    // Event / trigger system
    // ---------------------------------------------------------------------------
    emit(event) {
        const triggers = this.findTriggers(event);
        for (const trigger of triggers) {
            this.immediateQueue.push(trigger);
        }
        if (this.eventBatchDepth === 0) {
            this.processImmediateQueue();
        }
    }
    beginEventBatch() {
        this.eventBatchDepth++;
    }
    endEventBatch() {
        assert(this.eventBatchDepth > 0, "No event batch is active.");
        this.eventBatchDepth--;
        if (this.eventBatchDepth === 0) {
            this.processImmediateQueue();
        }
    }
    findTriggers(event) {
        var _a;
        var _b;
        const results = [];
        const eventCardId = this.getEventCardId(event);
        for (const card of Object.values(this.state.cards)) {
            const isDestroyedEventSource = event.type === "cardDestroyed" && eventCardId === card.id;
            if ((card.zone !== "play" && !isDestroyedEventSource) || card.faceDown) {
                continue;
            }
            const definition = this.getDefinition(card.id);
            for (const ability of (_b = (_a = definition.behavior) === null || _a === void 0 ? void 0 : _a.abilities) !== null && _b !== void 0 ? _b : []) {
                if (ability.type !== "triggered" || ability.event !== event.type) {
                    continue;
                }
                const context = {
                    sourceId: card.id,
                    controllerId: card.controllerId,
                    abilityId: ability.id,
                    event,
                    selected: {},
                };
                if (!ability.condition ||
                    this.evaluateCondition(ability.condition, context)) {
                    results.push({
                        sourceId: card.id,
                        ability,
                        context,
                    });
                }
            }
        }
        return results;
    }
    processImmediateQueue() {
        var _a, _b;
        while (this.immediateQueue.length > 0) {
            const trigger = this.immediateQueue.shift();
            if (!this.state.cards[trigger.sourceId] &&
                ((_a = trigger.context.event) === null || _a === void 0 ? void 0 : _a.type) !== "cardDestroyed") {
                continue;
            }
            if ((_b = trigger.ability.targets) === null || _b === void 0 ? void 0 : _b.length) {
                // A real client should request choices here.
                // For engine-only deterministic operation, auto-select only when
                // each target declaration has exactly enough legal candidates.
                this.autoSelectTargets(trigger.ability.targets, trigger.context);
            }
            for (const effect of trigger.ability.effects) {
                this.resolveEffect(effect, trigger.context);
                this.checkStateBasedActions();
            }
        }
    }
    // ---------------------------------------------------------------------------
    // Conditions / expressions
    // ---------------------------------------------------------------------------
    evaluateCondition(condition, context) {
        var _a;
        var _b;
        switch (condition.type) {
            case "and":
                return condition.conditions.every((condition) => this.evaluateCondition(condition, context));
            case "or":
                return condition.conditions.some((condition) => this.evaluateCondition(condition, context));
            case "not":
                return !this.evaluateCondition(condition.condition, context);
            case "sourceInZone":
                return ((_a = this.state.cards[context.sourceId]) === null || _a === void 0 ? void 0 : _a.zone) === condition.zone;
            case "sourceIsEventCard":
                return this.getEventCardId(context.event) === context.sourceId;
            case "eventCardControlledBy": {
                const eventCardId = this.getEventCardId(context.event);
                if (!eventCardId) {
                    return false;
                }
                const eventCard = this.state.cards[eventCardId];
                if (!eventCard) {
                    return false;
                }
                return (eventCard.controllerId ===
                    this.resolvePlayerRef(condition.player, context).id);
            }
            case "targetExists":
                return this.resolveTargetRef(condition.target, context) !== undefined;
            case "cardTypeIs": {
                const cardId = this.resolveTargetRef(condition.target, context);
                return (!!cardId && this.getDefinition(cardId).type === condition.cardType);
            }
            case "statCompare": {
                const cardId = this.resolveTargetRef(condition.target, context);
                if (!cardId) {
                    return false;
                }
                return compare(this.getStat(cardId, condition.stat), condition.operator, this.evaluateNumber(condition.value, context));
            }
            case "counterCompare": {
                const cardId = this.resolveTargetRef(condition.target, context);
                if (!cardId) {
                    return false;
                }
                const count = (_b = this.requireCard(cardId).counters[condition.counter]) !== null && _b !== void 0 ? _b : 0;
                return compare(count, condition.operator, this.evaluateNumber(condition.value, context));
            }
        }
    }
    evaluateNumber(expression, context) {
        var _a;
        if (typeof expression === "number") {
            return expression;
        }
        switch (expression.type) {
            case "stat": {
                const cardId = this.resolveTargetRef(expression.target, context);
                assert(cardId, "Unable to resolve stat target.");
                return this.getStat(cardId, expression.stat);
            }
            case "counter": {
                const cardId = this.resolveTargetRef(expression.target, context);
                assert(cardId, "Unable to resolve counter target.");
                return (_a = this.requireCard(cardId).counters[expression.counter]) !== null && _a !== void 0 ? _a : 0;
            }
            case "count":
                return this.queryCards(expression.selector, context).length;
            case "add":
                return expression.values.reduce((sum, value) => sum + this.evaluateNumber(value, context), 0);
            case "multiply":
                return expression.values.reduce((product, value) => product * this.evaluateNumber(value, context), 1);
        }
    }
    // ---------------------------------------------------------------------------
    // Targeting
    // ---------------------------------------------------------------------------
    validateTargetDeclarations(declarations, context) {
        var _a;
        for (const declaration of declarations) {
            const selected = (_a = context.selected[declaration.id]) !== null && _a !== void 0 ? _a : [];
            assert(selected.length === declaration.count, `Target '${declaration.id}' requires ${declaration.count} selection(s).`);
            const legal = new Set(this.queryCards(declaration.selector, context).map((card) => card.id));
            for (const selectedId of selected) {
                assert(legal.has(selectedId), `Illegal target '${selectedId}' for '${declaration.id}'.`);
            }
        }
    }
    autoSelectTargets(declarations, context) {
        for (const declaration of declarations) {
            if (context.selected[declaration.id]) {
                continue;
            }
            const candidates = this.queryCards(declaration.selector, context);
            assert(candidates.length === declaration.count, `Triggered ability '${context.abilityId}' requires a choice for target '${declaration.id}'.`);
            context.selected[declaration.id] = candidates.map((card) => card.id);
        }
    }
    matchesSelector(card, selector, context) {
        if (selector.controller) {
            const self = context.controllerId;
            const opponent = this.getOpponent(self).id;
            if (selector.controller === "self" && card.controllerId !== self) {
                return false;
            }
            if (selector.controller === "opponent" &&
                card.controllerId !== opponent) {
                return false;
            }
        }
        if (selector.owner) {
            const self = context.controllerId;
            const opponent = this.getOpponent(self).id;
            if (selector.owner === "self" && card.ownerId !== self) {
                return false;
            }
            if (selector.owner === "opponent" && card.ownerId !== opponent) {
                return false;
            }
        }
        if (selector.zone) {
            const zones = Array.isArray(selector.zone)
                ? selector.zone
                : [selector.zone];
            if (!zones.includes(card.zone)) {
                return false;
            }
        }
        const definition = this.getDefinition(card.id);
        if (selector.type) {
            if (selector.type === "resource") {
                if (!this.isResource(card.id))
                    return false;
            }
            else if (card.faceDown || definition.type !== selector.type) {
                return false;
            }
        }
        if (selector.subtype && !definition.subtype.includes(selector.subtype)) {
            return false;
        }
        if (selector.depleted !== undefined &&
            card.depleted !== selector.depleted) {
            return false;
        }
        if (selector.conditions &&
            !selector.conditions.every((condition) => this.evaluateCondition(condition, {
                ...context,
                selected: {
                    ...context.selected,
                    __candidate: [card.id],
                },
            }))) {
            return false;
        }
        return true;
    }
    resolveTargetRef(ref, context) {
        var _a;
        if (ref === "source") {
            return context.sourceId;
        }
        if (ref.type === "card") {
            return ref.id;
        }
        return (_a = context.selected[ref.id]) === null || _a === void 0 ? void 0 : _a[0];
    }
    resolvePlayerRef(ref, context) {
        if (ref === "controller") {
            return this.requirePlayer(context.controllerId);
        }
        if (ref === "owner") {
            return this.requirePlayer(this.requireCard(context.sourceId).ownerId);
        }
        if (ref === "activePlayer") {
            return this.requirePlayer(this.state.activePlayerId);
        }
        if (ref === "opponent") {
            return this.getOpponent(context.controllerId);
        }
        return this.requirePlayer(ref.id);
    }
    // ---------------------------------------------------------------------------
    // Costs
    // ---------------------------------------------------------------------------
    canPayCosts(costs, context) {
        // Simulate the costs against a cheap clone so multi-cost abilities
        // are checked transactionally.
        const clone = structuredClone(this.state);
        try {
            const engine = new SpoilsEngine(Object.values(this.definitions), clone);
            for (const cost of costs) {
                engine.payCost(cost, context, false);
            }
            return true;
        }
        catch {
            return false;
        }
    }
    payCosts(costs, context) {
        for (const cost of costs) {
            this.payCost(cost, context, true);
        }
    }
    payCost(cost, context, emitEvents) {
        var _a, _b;
        switch (cost.type) {
            case "payResources": {
                const amount = this.evaluateNumber(cost.amount, context);
                assert(amount >= 0, "Resource payment cannot be negative.");
                assert(this.getAvailableResourceCount(context.controllerId) >= amount, "Not enough unattached resources.");
                this.payNumericCost(context.controllerId, amount);
                return;
            }
            case "deplete": {
                const targetId = this.resolveTargetRef(cost.target, context);
                assert(targetId, "Missing depletion target.");
                const card = this.requireCard(targetId);
                assert(!card.depleted, "Card is already depleted.");
                card.depleted = true;
                if (emitEvents) {
                    this.emit({
                        type: "cardDepleted",
                        cardId: card.id,
                    });
                }
                return;
            }
            case "discard": {
                const player = this.resolvePlayerRef(cost.player, context);
                const legal = this.queryCards({
                    ...cost.selector,
                    controller: (_a = cost.selector.controller) !== null && _a !== void 0 ? _a : "self",
                    zone: (_b = cost.selector.zone) !== null && _b !== void 0 ? _b : "hand",
                }, context).filter((card) => card.controllerId === player.id);
                assert(legal.length >= cost.count, "Not enough cards available to discard.");
                // Barebones deterministic payment. A UI should normally supply
                // explicit selected cost cards.
                for (const card of legal.slice(0, cost.count)) {
                    this.moveCard(card.id, "discard", emitEvents);
                }
                return;
            }
            case "destroy": {
                const targetId = this.resolveTargetRef(cost.target, context);
                assert(targetId, "Missing destroy-cost target.");
                this.destroyCard(targetId, emitEvents);
                return;
            }
        }
    }
    // ---------------------------------------------------------------------------
    // Effects
    // ---------------------------------------------------------------------------
    resolveEffect(effect, context) {
        var _a, _b;
        switch (effect.type) {
            case "draw": {
                const player = this.resolvePlayerRef(effect.player, context);
                const amount = this.evaluateNumber(effect.amount, context);
                this.drawCards(player.id, amount);
                return;
            }
            case "playResource": {
                const targetId = this.resolveTargetRef(effect.target, context);
                assert(targetId, "Missing resource target.");
                const definition = this.getDefinition(targetId);
                const faceDown = effect.faceDown === "auto"
                    ? definition.type !== "resource"
                    : effect.faceDown;
                this.playResourceCard(context.controllerId, targetId, faceDown);
                return;
            }
            case "dealDamage": {
                const targetId = this.resolveTargetRef(effect.target, context);
                assert(targetId, "Missing damage target.");
                const target = this.requireCard(targetId);
                const amount = this.evaluateNumber(effect.amount, context);
                target.damage += amount;
                this.emit({
                    type: "damageDealt",
                    sourceId: context.sourceId,
                    targetId,
                    amount,
                });
                return;
            }
            case "modifyInfluence": {
                const player = this.resolvePlayerRef(effect.player, context);
                player.influence += this.evaluateNumber(effect.amount, context);
                return;
            }
            case "moveCard": {
                const targetId = this.resolveTargetRef(effect.target, context);
                assert(targetId, "Missing move target.");
                this.moveCard(targetId, effect.to);
                return;
            }
            case "destroy": {
                const targetId = this.resolveTargetRef(effect.target, context);
                assert(targetId, "Missing destroy target.");
                this.destroyCard(targetId);
                return;
            }
            case "deplete": {
                const targetId = this.resolveTargetRef(effect.target, context);
                assert(targetId, "Missing deplete target.");
                const card = this.requireCard(targetId);
                if (!card.depleted) {
                    card.depleted = true;
                    this.emit({
                        type: "cardDepleted",
                        cardId: targetId,
                    });
                }
                return;
            }
            case "restore": {
                const targetId = this.resolveTargetRef(effect.target, context);
                assert(targetId, "Missing restore target.");
                const card = this.requireCard(targetId);
                if (card.depleted) {
                    card.depleted = false;
                    this.emit({
                        type: "cardRestored",
                        cardId: targetId,
                    });
                }
                return;
            }
            case "addCounter": {
                const targetId = this.resolveTargetRef(effect.target, context);
                assert(targetId, "Missing counter target.");
                const card = this.requireCard(targetId);
                card.counters[effect.counter] =
                    ((_a = card.counters[effect.counter]) !== null && _a !== void 0 ? _a : 0) +
                        this.evaluateNumber(effect.amount, context);
                return;
            }
            case "removeCounter": {
                const targetId = this.resolveTargetRef(effect.target, context);
                assert(targetId, "Missing counter target.");
                const card = this.requireCard(targetId);
                card.counters[effect.counter] = Math.max(0, ((_b = card.counters[effect.counter]) !== null && _b !== void 0 ? _b : 0) -
                    this.evaluateNumber(effect.amount, context));
                return;
            }
            case "createModifier": {
                const targetId = this.resolveTargetRef(effect.target, context);
                assert(targetId, "Missing modifier target.");
                this.state.modifiers.push({
                    id: nextId("modifier"),
                    sourceId: context.sourceId,
                    sourceAbilityId: context.abilityId,
                    targetId,
                    stat: effect.stat,
                    operation: effect.operation,
                    value: this.evaluateNumber(effect.value, context),
                    duration: effect.duration,
                    createdTurn: this.state.turn,
                });
                return;
            }
        }
    }
    // ---------------------------------------------------------------------------
    // Continuous modifiers
    // ---------------------------------------------------------------------------
    getContinuousModifiers(targetId) {
        var _a;
        var _b;
        const results = [];
        for (const source of Object.values(this.state.cards)) {
            if (source.zone !== "play" || source.faceDown) {
                continue;
            }
            const definition = this.getDefinition(source.id);
            for (const ability of (_b = (_a = definition.behavior) === null || _a === void 0 ? void 0 : _a.abilities) !== null && _b !== void 0 ? _b : []) {
                if (ability.type !== "continuous") {
                    continue;
                }
                const context = {
                    sourceId: source.id,
                    controllerId: source.controllerId,
                    abilityId: ability.id,
                    selected: {
                        target: [targetId],
                    },
                };
                if (ability.condition &&
                    !this.evaluateCondition(ability.condition, context)) {
                    continue;
                }
                for (const modifier of ability.modifiers) {
                    const resolvedTarget = this.resolveTargetRef(modifier.target, context);
                    if (resolvedTarget !== targetId) {
                        continue;
                    }
                    results.push({
                        id: `continuous:${source.id}:${ability.id}:${targetId}:${modifier.stat}`,
                        sourceId: source.id,
                        sourceAbilityId: ability.id,
                        targetId,
                        stat: modifier.stat,
                        operation: modifier.operation,
                        value: this.evaluateNumber(modifier.value, context),
                        duration: {
                            type: "whileSourceInPlay",
                        },
                        createdTurn: this.state.turn,
                    });
                }
            }
        }
        return results;
    }
    // ---------------------------------------------------------------------------
    // State-based actions
    // ---------------------------------------------------------------------------
    checkStateBasedActions() {
        let changed = true;
        while (changed) {
            changed = false;
            for (const card of Object.values(this.state.cards)) {
                if (card.zone !== "play" ||
                    card.faceDown ||
                    this.getDefinition(card.id).type !== "character") {
                    continue;
                }
                const life = this.getStat(card.id, "life");
                if (life > 0 && card.damage >= life) {
                    this.destroyCard(card.id);
                    changed = true;
                    break;
                }
            }
        }
    }
    // ---------------------------------------------------------------------------
    // Zones / destruction
    // ---------------------------------------------------------------------------
    moveCard(cardId, to, emitEvents = true) {
        const card = this.requireCard(cardId);
        const from = card.zone;
        if (from === to) {
            return;
        }
        this.removeFromAllPlayerZones(cardId);
        card.zone = to;
        if (to !== "play") {
            card.faceDown = false;
            card.attachedTo = undefined;
        }
        // If a target leaves play, its attachments become unattached. This is
        // sufficient for faction/resource bookkeeping; card-specific attachment
        // departure effects can be layered on later.
        if (from === "play" && to !== "play") {
            for (const other of Object.values(this.state.cards)) {
                if (other.attachedTo === cardId)
                    other.attachedTo = undefined;
            }
        }
        const owner = this.requirePlayer(card.ownerId);
        const controller = this.requirePlayer(card.controllerId);
        const zoneOwner = to === "deck" || to === "hand" || to === "discard" || to === "void"
            ? owner
            : controller;
        const array = this.getZoneArray(zoneOwner, to);
        if (array) {
            array.push(cardId);
        }
        if (emitEvents) {
            this.emit({
                type: "cardMoved",
                cardId,
                from,
                to,
            });
        }
    }
    destroyCard(cardId, emitEvents = true) {
        const card = this.requireCard(cardId);
        if (card.zone !== "play") {
            throw new Error(`Cannot destroy '${cardId}' from zone '${card.zone}'.`);
        }
        const previousController = card.controllerId;
        card.damage = 0;
        card.depleted = false;
        this.moveCard(cardId, "discard", emitEvents);
        if (emitEvents) {
            this.emit({
                type: "cardDestroyed",
                cardId,
                controllerId: previousController,
            });
        }
    }
    removeFromAllPlayerZones(cardId) {
        for (const player of Object.values(this.state.players)) {
            player.deck = player.deck.filter((id) => id !== cardId);
            player.hand = player.hand.filter((id) => id !== cardId);
            player.play = player.play.filter((id) => id !== cardId);
            player.discard = player.discard.filter((id) => id !== cardId);
            player.void = player.void.filter((id) => id !== cardId);
        }
    }
    getZoneArray(player, zone) {
        switch (zone) {
            case "deck":
                return player.deck;
            case "hand":
                return player.hand;
            case "play":
                return player.play;
            case "discard":
                return player.discard;
            case "void":
                return player.void;
            case "deploying":
                return undefined;
        }
    }
    // ---------------------------------------------------------------------------
    // Turn handling
    // ---------------------------------------------------------------------------
    /**
     * "End turn" is an announcement. The opponent gets a normal response window
     * before the turn actually changes.
     */
    endTurn(playerId) {
        assert(playerId === this.state.activePlayerId, "Only the active player can end the turn.");
        assert(this.state.turnPhase === "main", "Complete the faction's develop rule before ending the turn.");
        assert(!this.state.battle, "Cannot end the turn during a battle.");
        assert(!this.state.responseWindow, "A response window is already open.");
        assert(this.responseStack.length === 0, "Cannot end turn with unresolved responses.");
        this.emit({
            type: "turnEnding",
            playerId,
        });
        this.openResponseWindow("endTurn", this.getOpponent(playerId).id, {
            type: "endTurn",
            playerId,
        });
    }
    finishTurn(playerId) {
        assert(playerId === this.state.activePlayerId, "Turn owner changed before end-turn resolution.");
        this.state.modifiers = this.state.modifiers.filter((modifier) => {
            var _a;
            if (modifier.duration.type === "untilEndOfTurn" &&
                modifier.createdTurn <= this.state.turn) {
                return false;
            }
            if (modifier.duration.type === "whileSourceInPlay") {
                return (!!modifier.sourceId &&
                    ((_a = this.state.cards[modifier.sourceId]) === null || _a === void 0 ? void 0 : _a.zone) === "play");
            }
            return true;
        });
        const next = this.getOpponent(playerId);
        this.state.turn++;
        this.state.activePlayerId = next.id;
        this.state.priorityPlayerId = next.id;
        this.state.turnPhase = "develop";
        this.applyFactionStartOfTurn(next.id);
        this.emit({
            type: "turnStarted",
            playerId: next.id,
        });
    }
    // ---------------------------------------------------------------------------
    // Battle system
    // ---------------------------------------------------------------------------
    getBattleView() {
        const battle = this.state.battle;
        if (!battle) {
            return undefined;
        }
        let actingPlayerId;
        if (this.state.responseWindow &&
            this.isBattleResponseWindow(this.state.responseWindow) &&
            this.state.responseWindow.phase === "acceptingResponses") {
            actingPlayerId = this.state.responseWindow.priorityPlayerId;
        }
        else if (battle.phase === "blocking") {
            actingPlayerId = battle.defenderPlayerId;
        }
        else if (battle.phase === "attackerDamageAssignment") {
            actingPlayerId = battle.attackerPlayerId;
        }
        else if (battle.phase === "defenderDamageAssignment") {
            actingPlayerId = battle.defenderPlayerId;
        }
        const attackerAssigning = battle.phase === "attackerDamageAssignment";
        const defenderAssigning = battle.phase === "defenderDamageAssignment";
        const sourceParty = attackerAssigning
            ? battle.attackingParty
            : defenderAssigning
                ? battle.blockingParty
                : [];
        const damageSources = sourceParty
            .filter((cardId) => this.canAssignBattleDamage(cardId, battle))
            .filter((cardId) => battle.speed === undefined
            ? false
            : this.getStat(cardId, "speed") === battle.speed)
            .map((cardId) => ({
            cardId,
            strength: this.getStat(cardId, "strength"),
            legalTargets: this.getLegalBattleDamageTargets(cardId, attackerAssigning, battle),
        }));
        return {
            battleId: battle.id,
            phase: battle.phase,
            speed: battle.speed,
            attackerPlayerId: battle.attackerPlayerId,
            defenderPlayerId: battle.defenderPlayerId,
            attackingParty: [...battle.attackingParty],
            blockingParty: [...battle.blockingParty],
            actingPlayerId,
            damageSources,
            lockedAssignments: [
                ...battle.attackerAssignments,
                ...battle.defenderAssignments,
            ].map((assignment) => structuredClone(assignment)),
        };
    }
    declareAttack(playerId, attackerIds, target) {
        assert(!this.state.battle, "Battle already in progress.");
        assert(!this.state.responseWindow, "Cannot attack during a response window.");
        assert(this.responseStack.length === 0, "Responses are unresolved.");
        assert(playerId === this.state.activePlayerId, "Only the active player may attack.");
        assert(this.state.turnPhase === "main", "Complete the faction's develop rule before attacking.");
        assert(attackerIds.length > 0, "No attackers selected.");
        assert(new Set(attackerIds).size === attackerIds.length, "An attacker was selected more than once.");
        let defenderId;
        if (target.type === "faction") {
            defenderId = target.playerId;
            assert(defenderId !== playerId, "You cannot attack your own faction.");
        }
        else {
            const targetCard = this.requireCard(target.cardId);
            assert(targetCard.zone === "play", "Attack target must be in play.");
            assert(this.getDefinition(target.cardId).type === "location", "Battles may target an opposing faction or location.");
            assert(targetCard.controllerId !== playerId, "You cannot attack your own location.");
            defenderId = targetCard.controllerId;
        }
        this.beginEventBatch();
        try {
            for (const attackerId of attackerIds) {
                const attacker = this.requireCard(attackerId);
                const definition = this.getDefinition(attackerId);
                assert(attacker.controllerId === playerId, "You do not control an attacker.");
                assert(attacker.zone === "play", "Attacker must be in play.");
                assert(definition.type === "character", "Only characters can attack.");
                assert(!attacker.depleted, "Depleted characters cannot attack.");
                assert(attacker.attackEligibleTurn === this.state.turn ||
                    this.definitionHasKeyword(definition, "aggro"), "Character did not start the turn in play under your control and does not have AGGRO.");
                attacker.depleted = true;
                this.emit({
                    type: "cardDepleted",
                    cardId: attackerId,
                });
            }
        }
        finally {
            this.endEventBatch();
        }
        const battle = {
            id: nextId("battle"),
            attackerPlayerId: playerId,
            defenderPlayerId: defenderId,
            target,
            attackingParty: [...attackerIds],
            blockingParty: [],
            phase: "afterAttackersResponse",
            assignedDamageBy: [],
            attackerAssignments: [],
            defenderAssignments: [],
        };
        this.state.battle = battle;
        this.emit({
            type: "battleStarted",
            battleId: battle.id,
        });
        // Spoils battle step: attacker may use tactics/abilities, then defender.
        this.openResponseWindow("battleAfterAttackers", battle.attackerPlayerId, {
            type: "battleBlocking",
            battleId: battle.id,
        });
    }
    declareBlockers(playerId, blockerIds) {
        const battle = this.requireBattle();
        assert(!this.state.responseWindow, "Responses must finish before blockers are declared.");
        assert(battle.defenderPlayerId === playerId, "Only the defending player can block.");
        assert(battle.phase === "blocking", "Battle is not accepting blockers.");
        const unique = new Set(blockerIds);
        assert(unique.size === blockerIds.length, "A blocker was selected more than once.");
        for (const blockerId of blockerIds) {
            const blocker = this.requireCard(blockerId);
            assert(blocker.controllerId === playerId, "You do not control that blocker.");
            assert(blocker.zone === "play", "Blocker must be in play.");
            assert(!blocker.faceDown, "A face-down resource cannot block.");
            assert(this.getDefinition(blockerId).type === "character", "Only characters can block.");
            assert(!blocker.depleted, "Depleted characters cannot block.");
        }
        this.assertCovertBlockingLegality(battle.attackingParty, blockerIds);
        battle.blockingParty = [...blockerIds];
        this.prepareNextSpeedGroupOrFinish(battle);
    }
    prepareNextSpeedGroupOrFinish(battle) {
        this.pruneBattleParties(battle);
        const nextSpeed = this.getNextBattleSpeed(battle);
        if (nextSpeed === undefined) {
            this.finishBattle(battle);
            return;
        }
        battle.speed = nextSpeed;
        battle.attackerAssignments = [];
        battle.defenderAssignments = [];
        battle.phase = "beforeDamageResponse";
        // Battle resolution step 2: attacker gets first opportunity.
        this.openResponseWindow("battleBeforeDamage", battle.attackerPlayerId, {
            type: "battleAssignDamage",
            battleId: battle.id,
        });
    }
    enterDamageAssignment(battle) {
        this.pruneBattleParties(battle);
        if (this.getBattleDamageSources(true, battle).length > 0) {
            battle.phase = "attackerDamageAssignment";
            this.state.priorityPlayerId = battle.attackerPlayerId;
            return;
        }
        if (this.getBattleDamageSources(false, battle).length > 0) {
            battle.phase = "defenderDamageAssignment";
            this.state.priorityPlayerId = battle.defenderPlayerId;
            return;
        }
        this.openPostAssignmentResponse(battle);
    }
    assignBattleDamage(playerId, assignments) {
        assert(!this.state.responseWindow, "Cannot assign battle damage while a response window is open.");
        const battle = this.requireBattle();
        const attackerAssigning = battle.phase === "attackerDamageAssignment";
        const defenderAssigning = battle.phase === "defenderDamageAssignment";
        assert(attackerAssigning || defenderAssigning, "Battle is not accepting damage assignments.");
        const expectedPlayerId = attackerAssigning
            ? battle.attackerPlayerId
            : battle.defenderPlayerId;
        assert(playerId === expectedPlayerId, "It is not this player's damage assignment.");
        const sources = this.getBattleDamageSources(attackerAssigning, battle);
        for (const sourceId of sources) {
            const sourceAssignments = assignments.filter((assignment) => assignment.sourceId === sourceId);
            const legalTargets = this.getLegalBattleDamageTargets(sourceId, attackerAssigning, battle);
            if (legalTargets.length === 0) {
                assert(sourceAssignments.length === 0, `Source '${sourceId}' has no legal damage target.`);
                continue;
            }
            const strength = this.getStat(sourceId, "strength");
            const total = sourceAssignments.reduce((sum, assignment) => sum + assignment.amount, 0);
            assert(total === strength, `Source '${sourceId}' must assign exactly ${strength} damage; received ${total}.`);
            for (const assignment of sourceAssignments) {
                assert(Number.isInteger(assignment.amount) && assignment.amount > 0, "Damage assignments must be positive integers.");
                assert(legalTargets.some((target) => this.sameBattleTarget(target, assignment.target)), `Illegal battle-damage target for '${sourceId}'.`);
            }
        }
        for (const assignment of assignments) {
            assert(sources.includes(assignment.sourceId), `Source '${assignment.sourceId}' is not part of the current speed group.`);
        }
        battle.assignedDamageBy.push(...sources);
        if (attackerAssigning) {
            battle.attackerAssignments = structuredClone(assignments);
            if (this.getBattleDamageSources(false, battle).length > 0) {
                battle.phase = "defenderDamageAssignment";
                this.state.priorityPlayerId = battle.defenderPlayerId;
            }
            else {
                this.openPostAssignmentResponse(battle);
            }
        }
        else {
            battle.defenderAssignments = structuredClone(assignments);
            this.openPostAssignmentResponse(battle);
        }
    }
    openPostAssignmentResponse(battle) {
        battle.phase = "afterDamageResponse";
        // Damage is now locked. Tactics/abilities can still change the game, but
        // the assignments themselves are immutable and survive source removal.
        this.openResponseWindow("battleAfterDamage", battle.attackerPlayerId, {
            type: "battleInflictDamage",
            battleId: battle.id,
        });
    }
    getBattleDamageSources(attackerSide, battle) {
        if (battle.speed === undefined) {
            return [];
        }
        const party = attackerSide ? battle.attackingParty : battle.blockingParty;
        return party.filter((cardId) => this.canAssignBattleDamage(cardId, battle) &&
            this.getStat(cardId, "speed") === battle.speed);
    }
    canAssignBattleDamage(cardId, battle) {
        const card = this.state.cards[cardId];
        return (!!card &&
            card.zone === "play" &&
            !battle.assignedDamageBy.includes(cardId));
    }
    getLegalBattleDamageTargets(_sourceId, attackerSide, battle) {
        if (!attackerSide) {
            return battle.attackingParty
                .filter((cardId) => this.isCardStillInBattle(cardId, battle))
                .map((cardId) => ({
                type: "card",
                cardId,
            }));
        }
        const blockers = battle.blockingParty.filter((cardId) => this.isCardStillInBattle(cardId, battle));
        if (blockers.length > 0) {
            return blockers.map((cardId) => ({
                type: "card",
                cardId,
            }));
        }
        if (battle.target.type === "faction") {
            return [
                {
                    type: "faction",
                    playerId: battle.target.playerId,
                },
            ];
        }
        const target = this.state.cards[battle.target.cardId];
        if (!target || target.zone !== "play") {
            return [];
        }
        return [
            {
                type: "card",
                cardId: battle.target.cardId,
            },
        ];
    }
    getNextBattleSpeed(battle) {
        const candidates = [
            ...battle.attackingParty,
            ...battle.blockingParty,
        ].filter((cardId) => this.canAssignBattleDamage(cardId, battle));
        if (!candidates.length) {
            return undefined;
        }
        return Math.max(...candidates.map((cardId) => this.getStat(cardId, "speed")));
    }
    inflictLockedBattleDamage(battle) {
        const assignments = [
            ...battle.attackerAssignments,
            ...battle.defenderAssignments,
        ];
        this.beginEventBatch();
        try {
            // Apply every locked amount before any triggered ability resolves.
            for (const assignment of assignments) {
                if (assignment.target.type === "faction") {
                    this.requirePlayer(assignment.target.playerId).influence -=
                        assignment.amount;
                    continue;
                }
                const target = this.state.cards[assignment.target.cardId];
                // Locking protects the source assignment, not a target which has
                // already left play before damage is inflicted.
                if (!target || target.zone !== "play") {
                    continue;
                }
                target.damage += assignment.amount;
            }
            for (const assignment of assignments) {
                if (assignment.target.type !== "card") {
                    continue;
                }
                const target = this.state.cards[assignment.target.cardId];
                if (!target || target.zone !== "play") {
                    continue;
                }
                this.emit({
                    type: "damageDealt",
                    sourceId: assignment.sourceId,
                    targetId: assignment.target.cardId,
                    amount: assignment.amount,
                });
            }
            // Lethal characters leave play only after the entire speed group's raw
            // damage has been applied.
            this.checkStateBasedActions();
        }
        finally {
            this.endEventBatch();
        }
        this.pruneBattleParties(battle);
        battle.speed = undefined;
        battle.attackerAssignments = [];
        battle.defenderAssignments = [];
    }
    pruneBattleParties(battle) {
        battle.attackingParty = battle.attackingParty.filter((cardId) => this.isCardStillInBattle(cardId, battle));
        battle.blockingParty = battle.blockingParty.filter((cardId) => this.isCardStillInBattle(cardId, battle));
    }
    isCardStillInBattle(cardId, battle) {
        const card = this.state.cards[cardId];
        if (!card || card.zone !== "play") {
            return false;
        }
        if (battle.attackingParty.includes(cardId)) {
            return card.controllerId === battle.attackerPlayerId;
        }
        if (battle.blockingParty.includes(cardId)) {
            return card.controllerId === battle.defenderPlayerId;
        }
        return false;
    }
    sameBattleTarget(a, b) {
        if (a.type !== b.type) {
            return false;
        }
        if (a.type === "card" && b.type === "card") {
            return a.cardId === b.cardId;
        }
        return (a.type === "faction" && b.type === "faction" && a.playerId === b.playerId);
    }
    assertCovertBlockingLegality(attackerIds, blockerIds) {
        if (blockerIds.length === 0) {
            return;
        }
        const attackersContainCovert = attackerIds.some((cardId) => this.hasKeyword(cardId, "covert"));
        const blockersContainCovert = blockerIds.some((cardId) => this.hasKeyword(cardId, "covert"));
        const attackingPartyIsCovert = attackerIds.every((cardId) => this.hasKeyword(cardId, "covert"));
        const blockingPartyIsCovert = blockerIds.every((cardId) => this.hasKeyword(cardId, "covert"));
        if (attackersContainCovert) {
            assert(blockingPartyIsCovert, "A party containing a COVERT character can only be blocked by a COVERT party.");
        }
        if (blockersContainCovert) {
            assert(attackingPartyIsCovert, "A COVERT character can only block a COVERT party.");
        }
    }
    isBattleResponseWindow(window) {
        return (window.kind === "battleAfterAttackers" ||
            window.kind === "battleBeforeDamage" ||
            window.kind === "battleAfterDamage");
    }
    requireBattle() {
        const battle = this.state.battle;
        assert(battle, "No battle in progress.");
        return battle;
    }
    requireBattleId(battleId) {
        const battle = this.requireBattle();
        assert(battle.id === battleId, `Expected battle '${battleId}', found '${battle.id}'.`);
        return battle;
    }
    /**
     * The finished battle remains in GameState until advanceFlow() is called,
     * allowing a renderer to show/animate the final state.
     */
    finishBattle(battle) {
        this.beginEventBatch();
        try {
            for (const cardId of [
                ...battle.attackingParty,
                ...battle.blockingParty,
            ]) {
                const card = this.state.cards[cardId];
                if (!card || card.zone !== "play") {
                    continue;
                }
                if (!card.depleted) {
                    card.depleted = true;
                    this.emit({
                        type: "cardDepleted",
                        cardId,
                    });
                }
            }
        }
        finally {
            this.endEventBatch();
        }
        battle.phase = "finished";
        battle.speed = undefined;
        this.emit({
            type: "battleEnded",
            battleId: battle.id,
        });
        this.state.priorityPlayerId = this.state.activePlayerId;
    }
    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------
    meetsThreshold(playerId, threshold) {
        var _a, _b;
        if (!threshold || threshold === 0 || threshold === "") {
            return true;
        }
        const required = parseThreshold(threshold);
        const available = this.getThresholds(playerId);
        for (const icon of [
            "rage",
            "greed",
            "deception",
            "elitism",
            "obsession",
            "volition",
        ]) {
            if (((_a = available[icon]) !== null && _a !== void 0 ? _a : 0) < ((_b = required[icon]) !== null && _b !== void 0 ? _b : 0)) {
                return false;
            }
        }
        return true;
    }
    getEventCardId(event) {
        if (!event) {
            return undefined;
        }
        switch (event.type) {
            case "cardPlayed":
            case "cardEnteredPlay":
            case "cardMoved":
            case "cardDestroyed":
            case "cardDepleted":
            case "cardRestored":
            case "resourcePlayed":
            case "abilityActivated":
                return event.cardId;
            case "damageDealt":
                return event.targetId;
            default:
                return undefined;
        }
    }
    definitionHasKeyword(definition, keyword) {
        var _a, _b;
        var _c;
        return (_c = (_b = (_a = definition.behavior) === null || _a === void 0 ? void 0 : _a.keywords) === null || _b === void 0 ? void 0 : _b.includes(keyword)) !== null && _c !== void 0 ? _c : false;
    }
    hasKeyword(cardId, keyword) {
        return this.definitionHasKeyword(this.getDefinition(cardId), keyword);
    }
    requireCard(id) {
        const card = this.state.cards[id];
        assert(card, `Card '${id}' not found.`);
        return card;
    }
    requirePlayer(id) {
        const player = this.state.players[id];
        assert(player, `Player '${id}' not found.`);
        return player;
    }
    getOpponent(playerId) {
        const opponent = Object.values(this.state.players).find((player) => player.id !== playerId);
        assert(opponent, "This barebones engine currently expects exactly two players.");
        return opponent;
    }
}
// -----------------------------------------------------------------------------
// Setup helpers
// -----------------------------------------------------------------------------
export function createCardInstance(definitionId, ownerId, zone = "deck") {
    return {
        id: nextId("card"),
        definitionId,
        ownerId,
        controllerId: ownerId,
        zone,
        depleted: false,
        damage: 0,
        faceDown: false,
        attachedTo: undefined,
        attackEligibleTurn: undefined,
        counters: {},
    };
}
export function createTwoPlayerGame(playerA, playerB, cards) {
    var _a;
    const players = {};
    for (const player of [playerA, playerB]) {
        players[player.id] = {
            id: player.id,
            name: player.name,
            factionId: undefined,
            influence: (_a = player.influence) !== null && _a !== void 0 ? _a : 0,
            deck: [],
            hand: [],
            play: [],
            discard: [],
            void: [],
        };
    }
    const cardMap = {};
    for (const card of cards) {
        cardMap[card.id] = card;
        const player = players[card.zone === "play" ? card.controllerId : card.ownerId];
        assert(player, `Unknown player for card '${card.id}'.`);
        switch (card.zone) {
            case "deck":
                player.deck.push(card.id);
                break;
            case "hand":
                player.hand.push(card.id);
                break;
            case "play":
                player.play.push(card.id);
                break;
            case "discard":
                player.discard.push(card.id);
                break;
            case "void":
                player.void.push(card.id);
                break;
            case "deploying":
                break;
        }
    }
    const state = {
        turn: 1,
        activePlayerId: playerA.id,
        priorityPlayerId: playerA.id,
        turnPhase: "main",
        setup: { phase: "complete" },
        started: true,
        players,
        cards: cardMap,
        modifiers: [],
        responseStack: [],
    };
    // Anything already in play before turn 1 began counts as having started
    // the turn in play under the first player's control.
    for (const cardId of players[playerA.id].play) {
        cardMap[cardId].attackEligibleTurn = 1;
    }
    return state;
}
export const CARD_CATALOG = cardsJson;
export function getCatalogCard(id) {
    const card = CARD_CATALOG.find((card) => card.id === id);
    assert(card, `Card definition '${id}' was not found in cards.json.`);
    return card;
}
export function findCatalogCard(name, set) {
    const matches = CARD_CATALOG.filter((card) => card.name === name && (set === undefined || card.set === set));
    assert(matches.length > 0, `Card '${name}'${set ? ` from '${set}'` : ""} was not found in cards.json.`);
    assert(matches.length === 1, `Card '${name}' matched ${matches.length} entries. Specify a set or use its id.`);
    return matches[0];
}
const STAPLE_RESOURCE_NAMES = new Set([
    "obsession",
    "greed",
    "elitism",
    "deception",
    "rage",
]);
function isStapleResourceDefinition(definition) {
    var _a;
    return (definition.type === "resource" &&
        (((_a = definition.resource) === null || _a === void 0 ? void 0 : _a.staple) === true ||
            STAPLE_RESOURCE_NAMES.has(definition.name.toLowerCase())));
}
function shuffleInPlace(items, random) {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
}
function resolveFactionAndDeck(definitions, setup) {
    const explicit = setup.factionDefinitionId
        ? definitions[setup.factionDefinitionId]
        : undefined;
    if (setup.factionDefinitionId) {
        assert(explicit, `Faction '${setup.factionDefinitionId}' was not found.`);
        assert(explicit.type === "faction", `'${explicit.name}' is not a faction card.`);
    }
    const factionCandidates = setup.deckDefinitionIds
        .map((id) => definitions[id])
        .filter((definition) => (definition === null || definition === void 0 ? void 0 : definition.type) === "faction");
    const factionDefinition = explicit !== null && explicit !== void 0 ? explicit : factionCandidates[0];
    assert(factionDefinition, `Player '${setup.id}' has no faction card.`);
    assert(explicit || factionCandidates.length === 1, `Player '${setup.id}' must have exactly one faction card.`);
    const normalizedFaction = withBuiltInFactionDefaults(factionDefinition);
    assert(normalizedFaction.faction, `Faction '${normalizedFaction.name}' is missing its faction configuration.`);
    let removedFaction = false;
    const deckDefinitionIds = setup.deckDefinitionIds.filter((id) => {
        if (!removedFaction && id === factionDefinition.id) {
            removedFaction = true;
            return false;
        }
        return true;
    });
    for (const id of deckDefinitionIds) {
        assert(definitions[id], `Deck references missing card '${id}'.`);
    }
    return {
        factionDefinition: normalizedFaction,
        deckDefinitionIds,
    };
}
function moveSetupCardToPlay(state, playerId, cardId) {
    const player = state.players[playerId];
    const card = state.cards[cardId];
    player.deck = player.deck.filter((id) => id !== cardId);
    card.zone = "play";
    card.faceDown = false;
    card.attachedTo = undefined;
    player.play.push(cardId);
}
function chooseStartingResourceIds(engine, playerId, rule) {
    var _a;
    const player = engine.state.players[playerId];
    const names = (_a = rule.names) === null || _a === void 0 ? void 0 : _a.map((name) => name.toLowerCase());
    const candidates = player.deck.filter((cardId) => {
        const definition = engine.getDefinition(cardId);
        if (definition.type !== "resource")
            return false;
        if ((names === null || names === void 0 ? void 0 : names.length) && !names.includes(definition.name.toLowerCase()))
            return false;
        if (rule.stapleOnly && !isStapleResourceDefinition(definition))
            return false;
        return true;
    });
    assert(candidates.length >= rule.count, `Faction setup requires ${rule.count} starting resource(s), but only ${candidates.length} were found.`);
    return candidates.slice(0, rule.count);
}
function drawSetupCards(state, playerId, count) {
    const player = state.players[playerId];
    const drawn = player.deck.splice(0, count);
    for (const cardId of drawn) {
        state.cards[cardId].zone = "hand";
        player.hand.push(cardId);
    }
}
/**
 * Creates a complete two-player game using faction-defined setup rules.
 *
 * Resulting flow for The Tournament Faction:
 *   faction enters play
 *   -> find 2 staple resources and put them in play
 *   -> shuffle
 *   -> first player draws 8, second draws 9
 *   -> mulligan decisions in turn order
 *   -> start turn 1 in the develop phase
 */
export function createTwoPlayerFactionGame(definitionsInput, playerA, playerB, options = {}) {
    var _a, _b;
    const normalizedDefinitions = definitionsInput.map(withBuiltInFactionDefaults);
    const definitions = Object.fromEntries(normalizedDefinitions.map((definition) => [definition.id, definition]));
    const firstPlayerId = (_a = options.firstPlayerId) !== null && _a !== void 0 ? _a : playerA.id;
    assert(firstPlayerId === playerA.id || firstPlayerId === playerB.id, "firstPlayerId must identify one of the two players.");
    const secondPlayerId = firstPlayerId === playerA.id ? playerB.id : playerA.id;
    const resolvedA = resolveFactionAndDeck(definitions, playerA);
    const resolvedB = resolveFactionAndDeck(definitions, playerB);
    const factionA = createCardInstance(resolvedA.factionDefinition.id, playerA.id, "play");
    const factionB = createCardInstance(resolvedB.factionDefinition.id, playerB.id, "play");
    const cardsA = resolvedA.deckDefinitionIds.map((id) => createCardInstance(id, playerA.id, "deck"));
    const cardsB = resolvedB.deckDefinitionIds.map((id) => createCardInstance(id, playerB.id, "deck"));
    const state = createTwoPlayerGame({ id: playerA.id, name: playerA.name, influence: 0 }, { id: playerB.id, name: playerB.name, influence: 0 }, [factionA, ...cardsA, factionB, ...cardsB]);
    state.turn = 1;
    state.activePlayerId = firstPlayerId;
    state.priorityPlayerId = firstPlayerId;
    state.turnPhase = "develop";
    state.started = false;
    state.players[playerA.id].factionId = factionA.id;
    state.players[playerB.id].factionId = factionB.id;
    state.players[playerA.id].influence =
        resolvedA.factionDefinition.faction.startingInfluence;
    state.players[playerB.id].influence =
        resolvedB.factionDefinition.faction.startingInfluence;
    const engine = new SpoilsEngine(normalizedDefinitions, state);
    for (const [playerId, factionDefinition] of [
        [playerA.id, resolvedA.factionDefinition],
        [playerB.id, resolvedB.factionDefinition],
    ]) {
        const resourceIds = chooseStartingResourceIds(engine, playerId, factionDefinition.faction.setup.startingResources);
        for (const cardId of resourceIds) {
            moveSetupCardToPlay(state, playerId, cardId);
        }
    }
    const random = (_b = options.random) !== null && _b !== void 0 ? _b : Math.random;
    shuffleInPlace(state.players[playerA.id].deck, random);
    shuffleInPlace(state.players[playerB.id].deck, random);
    const factionASetup = resolvedA.factionDefinition.faction.setup;
    const factionBSetup = resolvedB.factionDefinition.faction.setup;
    drawSetupCards(state, playerA.id, playerA.id === firstPlayerId
        ? factionASetup.openingHand.goingFirst
        : factionASetup.openingHand.goingSecond);
    drawSetupCards(state, playerB.id, playerB.id === firstPlayerId
        ? factionBSetup.openingHand.goingFirst
        : factionBSetup.openingHand.goingSecond);
    const mulliganOrder = [firstPlayerId, secondPlayerId].filter((playerId) => {
        var _a;
        var _b;
        const faction = engine.getFactionDefinition(playerId);
        return ((_b = (_a = faction === null || faction === void 0 ? void 0 : faction.setup.mulligan) === null || _a === void 0 ? void 0 : _a.count) !== null && _b !== void 0 ? _b : 0) > 0;
    });
    if (mulliganOrder.length) {
        state.setup = {
            phase: "mulligan",
            order: mulliganOrder,
            currentIndex: 0,
        };
    }
    else {
        state.setup = { phase: "complete" };
        engine.startGameAfterSetup();
    }
    return engine;
}
