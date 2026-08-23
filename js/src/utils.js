// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------
let nextIdCounter = 1;
export function nextId(prefix) {
    return `${prefix}_${nextIdCounter++}`;
}
export function structuredClone(value) {
    return JSON.parse(JSON.stringify(value));
}
export function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}
export function compare(left, op, right) {
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
