import { readFileSync } from "node:fs"
import { basename } from "node:path"
import { cju } from "@tscircuit/circuit-json-util"
import { KicadToCircuitJsonConverter } from "../lib"

// Run with: bun scripts/benchmark-converter-db.ts [board.kicad_pcb]
const path =
  process.argv[2] ?? "tests/assets/corne-keyboard/corne-keyboard.kicad_pcb"
const contents = readFileSync(path, "utf8")
const samples = { indexed: [] as number[], unindexed: [] as number[] }
let referenceOutput: string | undefined

for (let round = 0; round < 4; round++) {
  for (const mode of ["unindexed", "indexed"] as const) {
    const converter = new KicadToCircuitJsonConverter()
    converter.addFile(basename(path), contents)
    converter.initializePipeline()
    if (mode === "unindexed") converter.ctx!.db = cju([])
    const start = performance.now()
    converter.runUntilFinished()
    const milliseconds = performance.now() - start

    // Compare data without depending on JSON object key order or DB internals.
    const output = JSON.stringify(
      JSON.parse(converter.getOutputString()),
      (_key, value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(
              Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
            )
          : value,
    )
    referenceOutput ??= output
    if (output !== referenceOutput)
      throw new Error("Converter output changed between database backends")
    if (round > 0) samples[mode].push(milliseconds)
    console.log(
      JSON.stringify({
        mode,
        warmup: round === 0,
        milliseconds: Math.round(milliseconds),
      }),
    )
  }
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[1]!
const indexed = median(samples.indexed)
const unindexed = median(samples.unindexed)
console.log(
  JSON.stringify(
    {
      board: path,
      samples: 3,
      indexedMedianMs: Math.round(indexed),
      unindexedMedianMs: Math.round(unindexed),
      speedup: Number((unindexed / indexed).toFixed(2)),
      identicalOutput: true,
    },
    null,
    2,
  ),
)
