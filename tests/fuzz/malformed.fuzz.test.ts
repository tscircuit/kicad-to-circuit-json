import { expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import fc from "fast-check"
import { example, generate, type Mode } from "./generators"
import { config, extensions } from "./harness"
async function isolated(
  mode: Mode,
  input: string,
): Promise<{ status: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      ["run", "tests/fuzz/malformed-worker.ts"],
      { timeout: 2000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error)
          return reject(
            new Error(
              `Isolated ${mode} failed: ${error.message}\n${stderr.slice(0, 2000)}`,
            ),
          )
        try {
          resolve(JSON.parse(stdout))
        } catch (error) {
          reject(error)
        }
      },
    )
    child.stdin!.end(JSON.stringify({ mode, input }))
  })
}
for (const mode of ["pcb", "schematic", "symbol", "footprint"] as const) {
  test(`fuzz malformed input isolation: ${mode}`, async () => {
    const base = generate[mode](example)
    expect((await isolated(mode, base)).status).toBe("accepted")
    const arb = fc.record({
      index: fc.integer({ min: 0, max: base.length }),
      kind: fc.constantFrom("truncate", "delete", "insert", "nest"),
      junk: fc
        .array(fc.constantFrom("(", ")", '"', "\\", "0", "x", "\n", " "), {
          maxLength: 32,
        })
        .map((x) => x.join("")),
      depth: fc.integer({ min: 1, max: 128 }),
    })
    type Mutation = typeof arb extends fc.Arbitrary<infer T> ? T : never
    const mutate = (m: Mutation) =>
      m.kind === "truncate"
        ? base.slice(0, m.index)
        : m.kind === "delete"
          ? base.slice(0, m.index) + base.slice(m.index + 1)
          : m.kind === "insert"
            ? base.slice(0, m.index) + m.junk + base.slice(m.index)
            : "(".repeat(m.depth) + base + ")".repeat(m.depth)
    const options = config(Number(process.env.FUZZ_ROBUSTNESS_RUNS ?? 10))
    // Structured campaign FUZZ_RUNS must not inadvertently launch thousands of processes.
    options.numRuns = Number(process.env.FUZZ_ROBUSTNESS_RUNS ?? 10)
    if (!Number.isSafeInteger(options.numRuns) || options.numRuns < 1)
      throw new Error("Invalid FUZZ_ROBUSTNESS_RUNS")
    const r = await fc.check(
      fc.asyncProperty(arb, async (m) => {
        const response = await isolated(mode, mutate(m))
        expect(["accepted", "rejected"]).toContain(response.status)
      }),
      options,
    )
    if (r.failed) {
      const dir = `work/fuzz-failures/malformed-${mode}`
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        `${dir}/input.kicad_${extensions[mode]}`,
        mutate(r.counterexample![0]),
      )
      writeFileSync(
        `${dir}/failure.json`,
        JSON.stringify(
          {
            seed: r.seed,
            path: r.counterexamplePath,
            mutation: r.counterexample,
            error: String(r.errorInstance),
          },
          null,
          2,
        ),
      )
      throw r.errorInstance
    }
  }, 120000)
}
