import { describe, it, expect } from "vitest";
import { extractImports } from "./import-graph.js";

describe("extractImports", () => {
  it("extracts static named/default/namespace bindings + specifier", () => {
    const src = `
      import { A, B as C } from "./a.js";
      import D from "./d.js";
      import * as ns from "./ns.js";
      import type { T } from "./t.js";
    `;
    const recs = extractImports(src);
    const bySpec = new Map(recs.map((r) => [r.specifier, r]));
    expect(bySpec.get("./a.js")!.bindings.sort()).toEqual(["A", "C"]);
    expect(bySpec.get("./d.js")!.bindings).toEqual(["D"]);
    expect(bySpec.get("./ns.js")!.bindings).toEqual(["ns"]);
    expect(bySpec.get("./t.js")!.typeOnly).toBe(true);
  });

  it("extracts bare imports, export-from, and dynamic imports", () => {
    const src = `
      import "./side-effect.js";
      export { X } from "./x.js";
      export * from "./star.js";
      const m = await import("./dyn.js");
    `;
    const specs = extractImports(src).map((r) => r.specifier);
    expect(specs).toContain("./side-effect.js");
    expect(specs).toContain("./x.js");
    expect(specs).toContain("./star.js");
    expect(specs).toContain("./dyn.js");
  });

  it("ignores imports inside comments", () => {
    const src = `
      // import { Bad } from "./bad.js";
      /* import { AlsoBad } from "./also-bad.js"; */
      import { Good } from "./good.js";
    `;
    const specs = extractImports(src).map((r) => r.specifier);
    expect(specs).toEqual(["./good.js"]);
  });
});
