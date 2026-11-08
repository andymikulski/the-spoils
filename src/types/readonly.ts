// -----------------------------------------------------------------------------
// Read-only views
// -----------------------------------------------------------------------------

/**
 * `T` with every property, array and map reachable from it read-only. The engine's public methods type the
 * input they are handed (an action, a selection) this way: they copy what they keep and never write into it, so
 * a caller may pass a frozen object, keep using the one it sent, and send it again.
 */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;
