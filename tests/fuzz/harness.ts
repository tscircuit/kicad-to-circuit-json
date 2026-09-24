import { expect } from "bun:test"
import * as cj from "circuit-json"
import fc from "fast-check"
import { mkdirSync, writeFileSync } from "node:fs"
import {
  KicadFootprintToCircuitJsonConverter,
  KicadSymbolToCircuitJsonConverter,
  KicadToCircuitJsonConverter,
} from "../../lib"
import { generate, type Mode, type Model } from "./generators"
export type Element = Record<string, any>
export const extensions = {
  pcb: "pcb",
  schematic: "sch",
  symbol: "sym",
  footprint: "mod",
}
export function importText(mode: Mode, text: string) {
  const c =
    mode === "footprint"
      ? new KicadFootprintToCircuitJsonConverter()
      : mode === "symbol"
        ? new KicadSymbolToCircuitJsonConverter()
        : new KicadToCircuitJsonConverter()
  c.addFile(`fuzz.kicad_${extensions[mode]}`, text)
  c.runUntilFinished()
  return { elements: c.getOutput() as Element[], warnings: c.getWarnings() }
}
export function near(actual: number, expected: number, digits = 7) {
  expect(Number.isFinite(actual)).toBe(true)
  expect(actual).toBeCloseTo(expected, digits)
}
export function point(actual: any, expected: { x: number; y: number }) {
  near(actual.x, expected.x)
  near(actual.y, expected.y)
}
export function nearTree(a: any, b: any) {
  if (typeof a === "number" && typeof b === "number") near(a, b)
  else if (a && b && typeof a === "object" && typeof b === "object") {
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort())
    for (const key of Object.keys(a)) nearTree(a[key], b[key])
  } else expect(a).toEqual(b)
}
export function validate(
  elements: Element[],
  options: { allowBoardGraphicSentinel?: boolean } = {},
) {
  const ids = new Map<string, Set<string>>()
  for (const e of elements) {
    const schema =
      e.type === "source_component"
        ? cj.any_source_component
        : (cj as any)[e.type]
    expect(schema, `No runtime schema for ${e.type}`).toBeDefined()
    const parsed = schema.safeParse(e)
    if (!parsed.success)
      throw new Error(`Schema ${e.type}: ${parsed.error.message}`)
    const id = e[`${e.type}_id`]
    expect(typeof id).toBe("string")
    expect(id.length).toBeGreaterThan(0)
    const typed = ids.get(e.type) ?? new Set<string>()
    expect(typed.has(id), `Duplicate ${e.type}: ${id}`).toBe(false)
    typed.add(id)
    ids.set(e.type, typed)
  }
  const walk = (value: any, owner: Element) => {
    if (typeof value === "number") expect(Number.isFinite(value)).toBe(true)
    if (!value || typeof value !== "object") return
    for (const [key, v] of Object.entries(value)) {
      if (key === `${owner.type}_id` && value === owner) continue
      // Covers nested route endpoints and plural connectivity references too.
      const match = key.match(/((?:source|pcb|schematic)_[a-z_]+?)_ids?$/)
      // The pinned schema requires an owner string for board-level fabrication
      // text. The importer uses an empty string as its explicit unowned sentinel.
      // This opt-in applies only to that tested board-level contract, never ports.
      if (
        options.allowBoardGraphicSentinel &&
        key === "pcb_component_id" &&
        v === "" &&
        owner.type === "pcb_fabrication_note_text"
      )
        continue
      if (match && v !== undefined && v !== null) {
        const refs = Array.isArray(v) ? v : [v]
        for (const ref of refs)
          expect(
            ids.get(match[1]!)?.has(ref as string) ?? false,
            `Dangling ${owner.type}.${key}=${ref}`,
          ).toBe(true)
      }
      walk(v, owner)
    }
  }
  for (const e of elements) walk(e, e)
  // Ownership checks catch references that resolve to the wrong component.
  const byId = (type: string, id: string) =>
    elements.find((e) => e.type === type && e[`${type}_id`] === id)
  for (const e of elements) {
    if (e.pcb_port_id) {
      const port = byId("pcb_port", e.pcb_port_id)!
      expect(port.pcb_component_id).toBe(e.pcb_component_id)
    }
    if (
      (e.type === "pcb_port" || e.type === "schematic_port") &&
      e.source_port_id
    ) {
      const componentType =
        e.type === "pcb_port" ? "pcb_component" : "schematic_component"
      const component = byId(componentType, e[`${componentType}_id`])!
      const sourcePort = byId("source_port", e.source_port_id)!
      expect(sourcePort.source_component_id).toBe(component.source_component_id)
    }
  }
}
export const hits: Record<string, number> = {}
export function record(mode: Mode, elements: Element[]) {
  for (const type of new Set(elements.map((e) => e.type)))
    hits[`${mode}:${type}`] = (hits[`${mode}:${type}`] ?? 0) + 1
}
export function config(defaultRuns = 100) {
  const numRuns = Number(process.env.FUZZ_RUNS ?? defaultRuns)
  const seed = Number(process.env.FUZZ_SEED ?? 20260911)
  if (
    !Number.isSafeInteger(numRuns) ||
    numRuns < 1 ||
    !Number.isSafeInteger(seed)
  )
    throw new Error("Invalid FUZZ_RUNS/FUZZ_SEED")
  return {
    numRuns,
    seed,
    ...(process.env.FUZZ_PATH ? { path: process.env.FUZZ_PATH } : {}),
  }
}
export function property(
  name: string,
  mode: Mode,
  arb: fc.Arbitrary<Model>,
  verify: (m: Model) => void,
) {
  const result = fc.check(fc.property(arb, verify), config())
  if (result.failed) {
    const dir = `work/fuzz-failures/${name}`
    mkdirSync(dir, { recursive: true })
    const model = result.counterexample![0]
    writeFileSync(
      `${dir}/input.kicad_${extensions[mode]}`,
      generate[mode](model),
    )
    writeFileSync(
      `${dir}/failure.json`,
      JSON.stringify(
        {
          name,
          mode,
          seed: result.seed,
          path: result.counterexamplePath,
          model,
          error: String(result.errorInstance),
        },
        null,
        2,
      ),
    )
    throw new Error(
      `${name}: seed=${result.seed} path=${result.counterexamplePath}\n${result.errorInstance}`,
    )
  }
}
