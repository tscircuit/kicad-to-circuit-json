import { afterAll, expect, test } from "bun:test"
import { readFileSync, mkdirSync, writeFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { generate, modelArbitrary, example, type Mode } from "./generators"
import {
  importText,
  validate,
  property,
  record,
  hits,
  nearTree,
  config,
} from "./harness"
import { oracle } from "./element-oracles"
import manifest from "./coverage-manifest.json"

const activeModes = new Set<Mode>()

for (const mode of Object.keys(manifest.modes) as Mode[]) {
  test(`fuzz all elements: ${mode}`, () => {
    activeModes.add(mode)
    const verify = (m: typeof example) => {
      const result = importText(mode, generate[mode](m))
      validate(result.elements)
      expect(result.warnings).toEqual([])
      const expected = manifest.modes[mode]
      expect([...new Set(result.elements.map((e) => e.type))].sort()).toEqual(
        [...expected].sort(),
      )
      for (const type of expected) oracle(mode, type, m, result.elements)
      expect(result).toEqual(importText(mode, generate[mode](m)))
      if (mode === "pcb" || mode === "footprint")
        nearTree(result, importText(mode, generate[mode]({ ...m, x: 0, y: 0 })))
      record(mode, result.elements)
    }
    // Explicit small/large and side boundaries cannot be missed by random draws.
    verify(example)
    verify({ ...example, w: 4, h: 3, r: 0.2, bottom: true })
    verify({ ...example, w: 16, h: 12, r: 1, x: -100, y: 100 })
    property(`all-elements-${mode}`, mode, modelArbitrary, verify)
  })
}

test("coverage manifest matches every statically emitted Circuit JSON type", () => {
  const found = new Set<string>()
  function scan(dir: string) {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, ent.name)
      if (ent.isDirectory()) scan(path)
      else if (path.endsWith(".ts")) {
        const text = readFileSync(path, "utf8")
        for (const match of text.matchAll(/db\.([a-z_]+)\.insert/g))
          found.add(match[1]!)
        for (const match of text.matchAll(
          /type:\s*["']((?:pcb|source|schematic)_[a-z_]+)["']/g,
        ))
          found.add(match[1]!)
      }
    }
  }
  scan("lib")
  expect([...found].sort()).toEqual(manifest.elements.map((e) => e.type).sort())
  expect([...new Set(Object.values(manifest.modes).flat())].sort()).toEqual(
    [...found].sort(),
  )
})
afterAll(() => {
  mkdirSync("work/fuzz-results", { recursive: true })
  writeFileSync(
    "work/fuzz-results/element-coverage.json",
    JSON.stringify({ config: config(), hits }, null, 2),
  )
  // Do not weaken this when a generator stops producing a required element.
  for (const [mode, types] of Object.entries(manifest.modes).filter(([mode]) =>
    activeModes.has(mode as Mode),
  ))
    for (const type of types)
      expect(
        hits[`${mode}:${type}`] ?? 0,
        `Missing coverage ${mode}:${type}`,
      ).toBeGreaterThan(0)
})
