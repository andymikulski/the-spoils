// Source lint shared by the coverage gates (clauses/_coverage.test.ts, rules/_coverage.test.ts).

/** Lines of `assert.ok(x)` / `assert(x)` calls that pass no message. Strings, comments and regexes are blanked first. */
export function bareAsserts(source: string): number[] {
  const code = blankLiterals(source);
  const lines: number[] = [];
  const call = /(?<![\w$.])assert(?:\.ok)?\s*\(/g;
  for (let match = call.exec(code); match; match = call.exec(code)) {
    const start = match.index + match[0].length;
    const args: string[] = [];
    let depth = 1;
    let from = start;
    let i = start;
    for (; i < code.length && depth > 0; i++) {
      const c = code[i];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      else if (c === "," && depth === 1) {
        args.push(code.slice(from, i));
        from = i + 1;
      }
    }
    args.push(code.slice(from, i - 1));
    if (args.filter((arg) => arg.trim()).length === 1) lines.push(source.slice(0, match.index).split("\n").length);
  }
  return lines;
}

/** `source` with the contents of strings, template literals, comments and regex literals replaced by spaces. */
function blankLiterals(source: string): string {
  const out = source.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  let last = "";
  const skipString = (quote: string) => {
    const start = i++;
    while (i < source.length && source[i] !== quote) i += source[i] === "\\" ? 2 : 1;
    blank(start + 1, i++);
  };
  const skipTemplate = () => {
    let start = ++i;
    while (i < source.length && source[i] !== "`") {
      if (source[i] === "\\") i += 2;
      else if (source[i] === "$" && source[i + 1] === "{") {
        blank(start, i);
        i += 2;
        let depth = 1;
        while (i < source.length && depth > 0) {
          const c = source[i];
          if (c === "'" || c === '"') skipString(c);
          else if (c === "`") skipTemplate();
          else {
            if (c === "{") depth++;
            else if (c === "}") depth--;
            i++;
          }
        }
        start = i;
      } else i++;
    }
    blank(start, i++);
  };
  while (i < source.length) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      const start = i;
      while (i < source.length && source[i] !== "\n") i++;
      blank(start, i);
    } else if (c === "/" && source[i + 1] === "*") {
      const start = i;
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 2;
      blank(start, i);
    } else if (c === "'" || c === '"') {
      skipString(c);
      last = c;
    } else if (c === "`") {
      skipTemplate();
      last = c;
    } else if (c === "/" && (last === "" || "(,=:[!&|?{};".includes(last))) {
      // A regex literal (a division never follows these).
      const start = i++;
      let inClass = false;
      while (i < source.length && (inClass || source[i] !== "/")) {
        if (source[i] === "\\") i++;
        else if (source[i] === "[") inClass = true;
        else if (source[i] === "]") inClass = false;
        i++;
      }
      blank(start + 1, i++);
      last = "/";
    } else {
      if (!/\s/.test(c)) last = c;
      i++;
    }
  }
  return out.join("");
}
