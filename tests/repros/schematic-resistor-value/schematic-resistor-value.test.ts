import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { source_simple_resistor } from "circuit-json"
import { KicadToCircuitJsonConverter } from "../../../lib"

const schematic = readFileSync(
  new URL("./resistor.kicad_sch", import.meta.url),
  "utf8",
)

function convert(contents = schematic) {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("resistor.kicad_sch", contents)
  converter.runUntilFinished()
  const circuitJson = converter.getOutput()
  const resistor = circuitJson.find(
    (element) =>
      element.type === "source_component" &&
      element.ftype === "simple_resistor",
  )
  if (!resistor || resistor.type !== "source_component") {
    throw new Error("Expected a resistor source component")
  }
  return { resistor }
}

for (const [value, ohms] of [
  ["10k", 10_000],
  ["5,1K", 5_100],
  ["0", 0],
] as const) {
  test(`imports ${value} as a valid resistor with ${ohms} ohms`, () => {
    const { resistor } = convert(
      schematic.replace('"Value" "10k"', `"Value" "${value}"`),
    )
    const parsed = source_simple_resistor.parse(resistor)
    expect(parsed).toMatchObject({
      ftype: "simple_resistor",
      resistance: ohms,
      display_value: value,
    })
  })
}

for (const property of ["MPN", "Manufacturer Part Number"]) {
  test(`preserves an explicit resistor ${property} separately from Value`, () => {
    const { resistor } = convert(schematic.replace('"MPN"', `"${property}"`))
    expect(resistor.manufacturer_part_number).toBe("RC0603FR-0710KL")
  })
}

test("does not use resistor Value as an MPN when MPN is absent", () => {
  const { resistor } = convert(schematic.replace('"MPN"', '"Other"'))
  expect(resistor.manufacturer_part_number).toBeUndefined()
})
