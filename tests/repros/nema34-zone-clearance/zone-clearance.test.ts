import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { parseKicadPcb } from "kicadts"
import { KicadToCircuitJsonConverter } from "../../../lib"

const source = readFileSync(
  `${import.meta.dir}/nema34-reduced.kicad_pcb`,
  "utf8",
)
function importPours(text: string) {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("nema34.kicad_pcb", text)
  converter.runUntilFinished()
  return converter.getOutput().filter((el) => el.type === "pcb_copper_pour")
}

test("NEMA34: every filled fragment keeps its zone's own clearance", () => {
  const zones = parseKicadPcb(source).zones
  expect(zones.map((z) => z.connectPads?.clearance)).toEqual([0.16, 0.3])
  const pours = importPours(source)
  expect(pours).toHaveLength(3)
  expect(pours.map((p) => Reflect.get(p, "clearance"))).toEqual([
    0.16, 0.3, 0.3,
  ])
  expect(pours.filter((p) => p.layer === "inner1")).toHaveLength(2)
})

test("explicit zero is preserved and an absent clearance stays absent", () => {
  const zero = importPours(
    source.replaceAll("(clearance 0.3)", "(clearance 0)"),
  )
  expect(
    zero
      .filter((p) => p.layer === "inner1")
      .map((p) => Reflect.get(p, "clearance")),
  ).toEqual([0, 0])
  const omitted = importPours(source.replaceAll("(clearance 0.3)", ""))
  expect(
    omitted
      .filter((p) => p.layer === "inner1")
      .every((p) => !Object.hasOwn(p, "clearance")),
  ).toBe(true)
})

test("outline fallback also preserves clearance when cached fill is absent", () => {
  const pcb = parseKicadPcb(source)
  for (const zone of pcb.zones) zone.filledPolygons = []
  const pours = importPours(pcb.getString())
  expect(pours).toHaveLength(2)
  expect(pours.map((p) => Reflect.get(p, "clearance"))).toEqual([0.16, 0.3])
})
