import { expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import fc from "fast-check"
import { generate, modelArbitrary, example } from "./generators"
import { config, importText, validate } from "./harness"
import { getCircuitJsonSourceConnectivityGroups } from "../fixtures/kicad-gencad-netlist"

// Explicit opt-in: CI's dedicated KiCad job enables this and fails if CLI is absent.
const differential = process.env.FUZZ_KICAD === "1" ? test : test.skip
// Parse only the independent KiCad exporter result, not importer net assignments.
function signals(text: string) {
  const result: string[][] = []
  let inside = false,
    current: string[] = []
  const flush = () => {
    if (current.length) result.push([...new Set(current)].sort())
    current = []
  }
  for (const line of text.split(/\r?\n/)) {
    if (line === "$SIGNALS") {
      inside = true
      continue
    }
    if (line === "$ENDSIGNALS") {
      flush()
      break
    }
    if (!inside) continue
    if (line.startsWith("SIGNAL ")) flush()
    if (line.startsWith("NODE ")) {
      const values = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1])
      if (values.length >= 2) current.push(`${values[0]}.${values[1]}`)
    }
  }
  return result.sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b)),
  )
}
differential("fuzz independent KiCad GenCAD netlist parity", () => {
  const dir = "work/fuzz-results/kicad"
  mkdirSync(dir, { recursive: true })
  const version = execFileSync("kicad-cli", ["version"], {
    encoding: "utf8",
    timeout: 10000,
  }).trim()
  writeFileSync(`${dir}/version.txt`, version + "\n")
  const verify = (m: typeof example) => {
    const input = generate.pcb(m)
    writeFileSync(`${dir}/input.kicad_pcb`, input)
    execFileSync(
      "kicad-cli",
      [
        "pcb",
        "export",
        "gencad",
        "-o",
        `${dir}/output.cad`,
        `${dir}/input.kicad_pcb`,
      ],
      { timeout: 10000, maxBuffer: 1024 * 1024, stdio: "pipe" },
    )
    const expected = signals(readFileSync(`${dir}/output.cad`, "utf8"))
    // Prevent a parser failure from producing a vacuous empty-equals-empty pass.
    expect(expected).toEqual([["U1.1", "U1.2"]])
    const output = importText("pcb", input).elements
    validate(output)
    expect(getCircuitJsonSourceConnectivityGroups(output)).toEqual(expected)
  }
  const runs = Number(process.env.FUZZ_KICAD_RUNS ?? 5)
  if (!Number.isSafeInteger(runs) || runs < 1)
    throw new Error("Invalid FUZZ_KICAD_RUNS")
  const r = fc.check(fc.property(modelArbitrary, verify), {
    ...config(),
    numRuns: runs,
  })
  if (r.failed) {
    const fail = "work/fuzz-failures/kicad-differential"
    mkdirSync(fail, { recursive: true })
    writeFileSync(`${fail}/input.kicad_pcb`, generate.pcb(r.counterexample![0]))
    writeFileSync(
      `${fail}/failure.json`,
      JSON.stringify(
        {
          version,
          seed: r.seed,
          path: r.counterexamplePath,
          model: r.counterexample,
          error: String(r.errorInstance),
        },
        null,
        2,
      ),
    )
    throw r.errorInstance
  }
})
