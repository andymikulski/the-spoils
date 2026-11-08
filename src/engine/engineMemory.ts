// -----------------------------------------------------------------------------
// Engine memory
// -----------------------------------------------------------------------------
//
// `GameState.engineMemory` (see `EngineMemory`) is what the engine remembers between `perform()` calls. It is plain
// JSON keyed by card id; the engine reads and writes it through `StateMap` / `StateSet`, which give the Map / Set
// vocabulary over a record that lives in the state, so nothing the engine needs to continue is held on the engine
// instance.

import type { EngineMemory } from "../types/index.js";

export function emptyEngineMemory(): EngineMemory {
  return {
    immediateQueue: [],
    recentlyEntered: {},
    silentDepartures: {},
    uniquePrevented: {},
    enterOrigin: {},
    lastKnownCounters: {},
    lastKnownStats: {},
    lastKnownController: {},
    departedTokens: {},
    damageSources: {},
    destroyedByDamage: {},
    lethalDamageCause: {},
    contexts: {},
    nextContextId: 0
  };
}

/** Fills whatever a partially specified or older state leaves out of `memory`. */
export function normalizeEngineMemory(memory: Partial<EngineMemory> | undefined): EngineMemory {
  return { ...emptyEngineMemory(), ...memory };
}

function owns(table: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(table, key);
}

/** A Map over a record held in the game state: `table()` is read on every access, so it always names the live record. */
export class StateMap<V> implements Iterable<[string, V]> {
  constructor(private readonly table: () => Record<string, V>) {}

  get size(): number {
    return Object.keys(this.table()).length;
  }

  has(key: string): boolean {
    return owns(this.table(), key);
  }

  get(key: string): V | undefined {
    const table = this.table();
    return owns(table, key) ? table[key] : undefined;
  }

  set(key: string, value: V): this {
    this.table()[key] = value;
    return this;
  }

  delete(key: string): boolean {
    const table = this.table();
    if (!owns(table, key)) return false;
    delete table[key];
    return true;
  }

  clear(): void {
    const table = this.table();
    for (const key of Object.keys(table)) delete table[key];
  }

  [Symbol.iterator](): Iterator<[string, V]> {
    return Object.entries(this.table())[Symbol.iterator]();
  }
}

/** A Set over a record held in the game state (`{ [id]: true }`). */
export class StateSet implements Iterable<string> {
  constructor(private readonly table: () => Record<string, true>) {}

  get size(): number {
    return Object.keys(this.table()).length;
  }

  has(key: string): boolean {
    return owns(this.table(), key);
  }

  add(key: string): this {
    this.table()[key] = true;
    return this;
  }

  delete(key: string): boolean {
    const table = this.table();
    if (!owns(table, key)) return false;
    delete table[key];
    return true;
  }

  clear(): void {
    const table = this.table();
    for (const key of Object.keys(table)) delete table[key];
  }

  [Symbol.iterator](): Iterator<string> {
    return Object.keys(this.table())[Symbol.iterator]();
  }
}
