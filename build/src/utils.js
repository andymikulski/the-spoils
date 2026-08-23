export function structuredClone(value) {
    return JSON.parse(JSON.stringify(value));
}
