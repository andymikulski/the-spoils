import { ComparisonOperator } from "./ids_primitives.js";
export declare function nextId(prefix: string): string;
export declare function structuredClone<T>(value: T): T;
export declare function assert(condition: unknown, message: string): asserts condition;
export declare function compare(left: number, op: ComparisonOperator, right: number): boolean;
