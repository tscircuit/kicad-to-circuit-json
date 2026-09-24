import { expect, test } from "bun:test"
import fc from "fast-check"
import { mkdirSync, writeFileSync } from "node:fs"
import { KicadFootprintToCircuitJsonConverter } from "../../lib"

// Run from the repository root. Every failure records the minimized KiCad input.
const seed = Number(process.env.FUZZ_SEED ?? 20260911)
const numRuns = Number(process.env.FUZZ_RUNS ?? 100)
if (
  !Number.isSafeInteger(seed) ||
  !Number.isSafeInteger(numRuns) ||
  numRuns < 1
) {
  throw new Error("FUZZ_SEED must be an integer; FUZZ_RUNS must be positive")
}
const mm = (min: number, max: number) =>
  fc.integer({ min, max }).map((n) => n / 1000)
const geometry = fc.record({
  x: mm(-100000, 100000),
  y: mm(-100000, 100000),
  width: mm(100, 10000),
  height: mm(100, 10000),
  angle: fc.oneof(
    fc.constantFrom(0, 90, 180, 270, -90, 360, 45),
    mm(-360000, 360000),
  ),
  originX: mm(-100000, 100000),
  originY: mm(-100000, 100000),
  bottom: fc.boolean(),
})
type Geometry = typeof geometry extends fc.Arbitrary<infer T> ? T : never
const cases = [
  "rect",
  "oval",
  "circle",
  "roundrect",
  "connect",
  "thru_hole",
  "np_thru_hole",
] as const
type Kind = (typeof cases)[number]
function fixture(g: Geometry, kind: Kind, legacy = false) {
  const side = g.bottom ? "B" : "F"
  const through = kind === "thru_hole" || kind === "np_thru_hole"
  const padType = through ? kind : kind === "connect" ? "connect" : "smd"
  const shape = through ? "circle" : kind === "connect" ? "rect" : kind
  const height = shape === "circle" ? g.width : g.height
  const layers = through ? '"*.Cu" "*.Mask"' : `"${side}.Cu" "${side}.Mask"`
  return `(${legacy ? "module" : "footprint"} "Fuzz:Pad" (layer "${side}.Cu")
    (at ${g.originX} ${g.originY})
    (pad "1" ${padType} ${shape} (at ${g.x} ${g.y} ${g.angle})
      (size ${g.width} ${height}) (layers ${layers})
      ${through ? `(drill ${g.width / 2})` : ""}
      ${kind === "roundrect" ? "(roundrect_rratio 0.25)" : ""}))`
}
function convert(input: string) {
  const converter = new KicadFootprintToCircuitJsonConverter()
  converter.addFile("generated.kicad_mod", input)
  converter.runUntilFinished()
  return converter.getOutput()
}
function finiteTree(value: unknown) {
  if (typeof value === "number") expect(Number.isFinite(value)).toBe(true)
  else if (value && typeof value === "object") {
    for (const child of Object.values(value)) finiteTree(child)
  }
}
function nearTree(a: unknown, b: unknown) {
  if (typeof a === "number" && typeof b === "number")
    expect(a).toBeCloseTo(b, 8)
  else if (a && b && typeof a === "object" && typeof b === "object") {
    expect(Object.keys(a)).toEqual(Object.keys(b))
    for (const key of Object.keys(a)) nearTree((a as any)[key], (b as any)[key])
  } else expect(a).toEqual(b)
}
function verify(g: Geometry, kind: Kind) {
  const input = fixture(g, kind)
  const output = convert(input)
  finiteTree(output)
  expect(output).toEqual(convert(input))
  expect(output).toEqual(convert(fixture(g, kind, true)))
  // Standalone import removes the footprint origin, so this translation is invariant.
  nearTree(output, convert(fixture({ ...g, originX: 0, originY: 0 }, kind)))
  const ids = output.map((e: any) => e[`${e.type}_id`])
  expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true)
  expect(new Set(ids).size).toBe(ids.length)
  expect(output.filter((e) => e.type === "pcb_component")).toHaveLength(1)
  expect(output.filter((e) => e.type === "source_component")).toHaveLength(1)
  const type =
    kind === "thru_hole"
      ? "pcb_plated_hole"
      : kind === "np_thru_hole"
        ? "pcb_hole"
        : "pcb_smtpad"
  const pads = output.filter((e) => e.type === type)
  expect(pads).toHaveLength(1)
  const pad = pads[0] as any
  expect(pad.x).toBeCloseTo(g.x, 8)
  expect(pad.y).toBeCloseTo(-g.y, 8)
  const component = output.find((e) => e.type === "pcb_component") as any
  expect(pad.pcb_component_id).toBe(component.pcb_component_id)
  if (type === "pcb_smtpad") {
    expect(pad.layer).toBe(g.bottom ? "bottom" : "top")
    if (kind === "circle") expect(pad.radius).toBeCloseTo(g.width / 2, 8)
    else {
      // An independent bounding-envelope oracle tolerates canonical right-angle
      // shape/dimension rewrites while detecting lost or double-applied angles.
      const a = (g.angle * Math.PI) / 180
      const b = ((pad.ccw_rotation ?? 0) * Math.PI) / 180
      const envelope = (w: number, h: number, theta: number, pill: boolean) => {
        if (!pill)
          return [
            Math.abs(w * Math.cos(theta)) + Math.abs(h * Math.sin(theta)),
            Math.abs(w * Math.sin(theta)) + Math.abs(h * Math.cos(theta)),
          ]
        const d = Math.min(w, h)
        return [
          d +
            Math.abs((w - d) * Math.cos(theta)) +
            Math.abs((h - d) * Math.sin(theta)),
          d +
            Math.abs((w - d) * Math.sin(theta)) +
            Math.abs((h - d) * Math.cos(theta)),
        ]
      }
      const expected = envelope(g.width, g.height, a, kind === "oval")
      const actual = envelope(pad.width, pad.height, b, kind === "oval")
      expect(actual[0]).toBeCloseTo(expected[0]!, 6)
      expect(actual[1]).toBeCloseTo(expected[1]!, 6)
    }
  } else {
    expect(pad.hole_diameter).toBeCloseTo(g.width / 2, 8)
    if (type === "pcb_plated_hole")
      expect(pad.outer_diameter).toBeCloseTo(g.width, 8)
  }
}
for (const kind of cases) {
  test(`fuzz footprint ${kind}`, () => {
    const result = fc.check(
      fc.property(geometry, (g) => verify(g, kind)),
      {
        seed,
        numRuns,
        ...(process.env.FUZZ_PATH ? { path: process.env.FUZZ_PATH } : {}),
      },
    )
    if (result.failed) {
      const dir = "work/fuzz-failures"
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        `${dir}/${kind}.kicad_mod`,
        fixture(result.counterexample![0], kind),
      )
      writeFileSync(
        `${dir}/${kind}.json`,
        JSON.stringify(
          {
            seed: result.seed,
            path: result.counterexamplePath,
            kind,
            counterexample: result.counterexample,
            error: String(result.errorInstance),
          },
          null,
          2,
        ),
      )
      throw new Error(
        `Fuzz failure: ${kind}, seed=${result.seed}, path=${result.counterexamplePath}\n${result.errorInstance}`,
      )
    }
  })
}
