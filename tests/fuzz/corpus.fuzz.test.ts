import { expect, test } from "bun:test"
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import fc from "fast-check"
import { importText, validate, config } from "./harness"
import type { Mode } from "./generators"

// Mutate token separators, never characters inside quoted strings. This should
// preserve the semantic meaning of real KiCad fixtures exactly.
function whitespace(input: string, separator: string) {
  let quoted = false,
    escaped = false,
    result = ""
  for (const ch of input) {
    if (quoted) {
      result += ch
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') quoted = false
    } else if (ch === '"') {
      quoted = true
      result += ch
    } else result += /\s/.test(ch) ? separator : ch
  }
  return result
}
for (const [mode, path] of [
  ["footprint", "tests/assets/D_0402_1005Metric.kicad_mod"],
  ["footprint", "tests/assets/DIP-10_W10.16mm.kicad_mod"],
  ["symbol", "tests/assets/CM5IO.kicad_sym"],
] as [Mode, string][]) {
  test(`fuzz corpus token separators: ${path}`, () => {
    const input = readFileSync(path, "utf8"),
      baseline = importText(mode, input)
    validate(baseline.elements)
    expect(baseline.elements.length).toBeGreaterThan(0)
    const arb = fc
      .array(fc.constantFrom(" ", "\n", "\t", "\r\n"), {
        minLength: 1,
        maxLength: 3,
      })
      .map((x) => x.join(""))
    const r = fc.check(
      fc.property(arb, (separator) => {
        const actual = importText(mode, whitespace(input, separator))
        validate(actual.elements)
        expect(actual).toEqual(baseline)
      }),
      { ...config(), numRuns: Number(process.env.FUZZ_CORPUS_RUNS ?? 5) },
    )
    if (r.failed) {
      const dir = `work/fuzz-failures/corpus-${path.split("/").pop()}`
      mkdirSync(dir, { recursive: true })
      writeFileSync(`${dir}/input`, whitespace(input, r.counterexample![0]))
      writeFileSync(
        `${dir}/failure.json`,
        JSON.stringify(
          {
            seed: r.seed,
            path: r.counterexamplePath,
            fixture: path,
            separator: r.counterexample,
            error: String(r.errorInstance),
          },
          null,
          2,
        ),
      )
      throw r.errorInstance
    }
  })
}
