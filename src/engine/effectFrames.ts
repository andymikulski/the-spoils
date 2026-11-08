// -----------------------------------------------------------------------------
// Parked effect lists and the contexts they share
// -----------------------------------------------------------------------------
//
// An effect list that waits on a player's choice is parked in `GameState.pendingEffectFrames`. All the lists of one
// resolution (and the stack item they belong to, and the choice they opened) read and write one
// `ResolutionContext`: an answer is written once and every later effect list sees it. That context is therefore held
// once, in `EngineMemory.contexts`, and the parked frames and the open choice name it by id. Nothing in the state is
// reachable by two paths, so a save restores a game exactly.
//
// While the engine runs a list it works with an `EffectFrame`: the same frame with its context (and stack item)
// attached. `FrameStack` is the parked stack: it turns an `EffectFrame` into the stored form when it is pushed and
// back when it is popped or read.

import type {
  ContextId,
  Effect,
  EngineMemory,
  GameState,
  PendingEffectFrame,
  ResolutionContext,
  StackItem
} from "../types/index.js";

/** An effect list being run or resumed: a `PendingEffectFrame` with its context and stack item attached. */
export interface EffectFrame {
  effects: Effect[];
  index: number;
  context: ResolutionContext;
  finishStackItem?: StackItem;
  recordPickZones?: boolean;
  announcedIndex?: number;
}

/** The parts of a context that are objects of their own. Each context in the table owns its own copies. */
const CONTEXT_PARTS = [
  "selected",
  "variables",
  "pickZones",
  "pickTypeLost",
  "resolvedPicked",
  "named",
  "resourceRevealOffered",
  "event"
] as const;

/** The context table of `EngineMemory`: contexts by id, each one an object nothing else in the state holds. */
export class ContextTable {
  constructor(private readonly memory: () => EngineMemory) {}

  /** The id `context` is held under, entering it into the table if it is not there yet. Looked up by identity. */
  idOf(context: ResolutionContext): ContextId {
    const memory = this.memory();
    for (const [id, held] of Object.entries(memory.contexts)) {
      if (held === context) return id;
    }
    // A context built from another (`{ ...context }`) still points at that one's nested objects: it gets its own.
    for (const part of CONTEXT_PARTS) {
      if (context[part] !== undefined) (context as unknown as Record<string, unknown>)[part] = structuredClone(context[part]);
    }
    memory.nextContextId += 1;
    const id = `context_${memory.nextContextId}`;
    memory.contexts[id] = context;
    return id;
  }

  /** The context held under `id`. */
  get(id: ContextId): ResolutionContext {
    const context = this.memory().contexts[id];
    if (!context) throw new Error(`No resolution context '${id}'.`);
    return context;
  }

  find(id: ContextId | undefined): ResolutionContext | undefined {
    return id === undefined ? undefined : this.memory().contexts[id];
  }

  /** Drops every context not in `keep`. */
  prune(keep: ReadonlySet<ContextId>): void {
    const contexts = this.memory().contexts;
    for (const id of Object.keys(contexts)) {
      if (!keep.has(id)) delete contexts[id];
    }
  }
}

/** `GameState.pendingEffectFrames`, read and written as `EffectFrame`s. */
export class FrameStack implements Iterable<EffectFrame> {
  constructor(
    private readonly state: () => GameState,
    private readonly contexts: ContextTable
  ) {}

  private get stored(): PendingEffectFrame[] {
    return this.state().pendingEffectFrames;
  }

  get length(): number {
    return this.stored.length;
  }

  push(...frames: EffectFrame[]): void {
    for (const frame of frames) this.stored.push(this.park(frame));
  }

  pop(): EffectFrame | undefined {
    const parked = this.stored.pop();
    return parked && this.open(parked);
  }

  /** Removes the frames from position `start` on and returns them, oldest first. */
  splice(start: number): EffectFrame[] {
    return this.stored.splice(start).map(parked => this.open(parked));
  }

  some(test: (frame: EffectFrame) => boolean): boolean {
    return this.stored.some(parked => test(this.open(parked)));
  }

  [Symbol.iterator](): Iterator<EffectFrame> {
    return this.stored.map(parked => this.open(parked))[Symbol.iterator]();
  }

  /** Gives every parked frame the context `change` makes of its current one (each frame then holds a context of its own). */
  rewriteContexts(change: (context: ResolutionContext) => ResolutionContext): void {
    for (const parked of this.stored) {
      parked.contextId = this.contexts.idOf(change(this.contexts.get(parked.contextId)));
    }
  }

  /** The ids of the contexts the parked frames name. */
  contextIds(): Set<ContextId> {
    return new Set(this.stored.map(parked => parked.contextId));
  }

  private park(frame: EffectFrame): PendingEffectFrame {
    const { context, finishStackItem, ...rest } = frame;
    const parked: PendingEffectFrame = { ...rest, contextId: this.contexts.idOf(context) };
    if (finishStackItem) {
      const { context: _context, effects: _effects, ...item } = finishStackItem;
      parked.finishStackItem = item;
    }
    return parked;
  }

  private open(parked: PendingEffectFrame): EffectFrame {
    const { contextId, finishStackItem, ...rest } = parked;
    const context = this.contexts.get(contextId);
    const frame: EffectFrame = { ...rest, context };
    if (finishStackItem) frame.finishStackItem = { ...finishStackItem, effects: parked.effects, context };
    return frame;
  }
}
