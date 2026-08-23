import { ComparisonOperator } from "./ids_primitives.js";

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------
let nextIdCounter = 1;
export function nextId(prefix: string): string {
  return `${prefix}_${nextIdCounter++}`;
}
export function structuredClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
export function compare(
  left: number,
  op: ComparisonOperator,
  right: number,
): boolean {
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
