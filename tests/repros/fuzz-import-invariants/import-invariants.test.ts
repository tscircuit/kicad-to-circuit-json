import { expect, test } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { collectEvidence } from "./evidence"

// IDs and reference validity are data invariants. They are not represented by
// artificial pictures; the adjacent real-render tests use the actual engines.
test("KiCad import corrected invariant snapshots", () => {
  const evidence = collectEvidence()
  expect(evidence).toHaveLength(5)
  const dir = join(import.meta.dir, "__snapshots__")
  if (process.env.UPDATE_IMPORT_REPRO_SNAPSHOTS === "1")
    mkdirSync(dir, { recursive: true })
  for (const entry of evidence) {
    expect(entry.passing, entry.name).toBe(true)
    const path = join(dir, `${entry.name}.json`)
    const json = JSON.stringify(entry, null, 2) + "\n"
    if (process.env.UPDATE_IMPORT_REPRO_SNAPSHOTS === "1")
      writeFileSync(path, json)
    expect(readFileSync(path, "utf8")).toBe(json)
  }
})
