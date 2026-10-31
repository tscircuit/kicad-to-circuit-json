import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  source_simple_capacitor,
  source_simple_inductor,
  source_simple_resistor,
} from "circuit-json"
import { KicadToCircuitJsonConverter } from "../lib"

test("schematic import populates numeric resistance, capacitance, and inductance on passive source components", () => {
  const schematicContent = `(kicad_sch
  (version 20231120)
  (generator "eeschema")
  (lib_symbols
    (symbol "Device:R"
      (property "Reference" "R" (at 2.032 0 90))
      (property "Value" "R" (at 0 0 90))
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1"))
        (pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2"))
      )
    )
    (symbol "Device:C"
      (property "Reference" "C" (at 0.635 2.54 0))
      (property "Value" "C" (at 0.635 -2.54 0))
      (symbol "C_1_1"
        (pin passive line (at 0 3.81 270) (length 2.794) (name "~") (number "1"))
        (pin passive line (at 0 -3.81 90) (length 2.794) (name "~") (number "2"))
      )
    )
    (symbol "Device:L"
      (property "Reference" "L" (at -1.016 0 90))
      (property "Value" "L" (at 1.016 0 90))
      (symbol "L_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1"))
        (pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2"))
      )
    )
  )
  (symbol (lib_id "Device:R") (at 50.8 50.8 0) (unit 1)
    (uuid "00000000-0000-0000-0000-000000000001")
    (property "Reference" "R1" (at 52.832 49.53 0))
    (property "Value" "10k" (at 52.832 52.07 0))
  )
  (symbol (lib_id "Device:C") (at 76.2 50.8 0) (unit 1)
    (uuid "00000000-0000-0000-0000-000000000002")
    (property "Reference" "C1" (at 78.232 49.53 0))
    (property "Value" "100n" (at 78.232 52.07 0))
  )
  (symbol (lib_id "Device:L") (at 101.6 50.8 0) (unit 1)
    (uuid "00000000-0000-0000-0000-000000000003")
    (property "Reference" "L1" (at 103.632 49.53 0))
    (property "Value" "4.7uH" (at 103.632 52.07 0))
  )
)`

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("passive-values.kicad_sch", schematicContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  const sourceComponents = circuitJson.filter(
    (element) => element.type === "source_component",
  )

  const resistor = sourceComponents.find(
    (component) => component.ftype === "simple_resistor",
  )
  const capacitor = sourceComponents.find(
    (component) => component.ftype === "simple_capacitor",
  )
  const inductor = sourceComponents.find(
    (component) => component.ftype === "simple_inductor",
  )

  expect(source_simple_resistor.safeParse(resistor).success).toBe(true)
  expect(resistor).toMatchObject({
    manufacturer_part_number: "10k",
    resistance: 10_000,
  })

  expect(source_simple_capacitor.safeParse(capacitor).success).toBe(true)
  if (capacitor?.ftype !== "simple_capacitor") {
    throw new Error("Expected simple_capacitor")
  }
  expect(typeof capacitor.capacitance).toBe("number")
  expect(capacitor.capacitance).toBeCloseTo(100e-9, 12)

  expect(source_simple_inductor.safeParse(inductor).success).toBe(true)
  if (inductor?.ftype !== "simple_inductor") {
    throw new Error("Expected simple_inductor")
  }
  expect(typeof inductor.inductance).toBe("number")
  expect(inductor.inductance).toBeCloseTo(4.7e-6, 12)
})

test("parses R-notation resistor values in hsp-usb-led schematic", () => {
  const schematicContent = readFileSync(
    "tests/assets/hsp-usb-led.kicad_sch",
    "utf8",
  )
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("hsp-usb-led.kicad_sch", schematicContent)
  converter.runUntilFinished()

  const resistors = converter
    .getOutput()
    .filter(
      (element) =>
        element.type === "source_component" &&
        element.ftype === "simple_resistor",
    )

  expect(resistors).toHaveLength(3)
  for (const resistor of resistors) {
    expect(source_simple_resistor.safeParse(resistor).success).toBe(true)
  }
  expect(
    resistors
      .map((r) => (r.ftype === "simple_resistor" ? r.resistance : undefined))
      .sort((a, b) => (a ?? 0) - (b ?? 0)),
  ).toEqual([150, 5100, 5100])
})
