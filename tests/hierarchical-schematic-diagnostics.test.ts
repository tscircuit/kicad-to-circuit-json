import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../lib"

const sheet = (file: string, index = 0) => `(sheet (at 20 20) (size 30 20)
  (uuid "00000000-0000-0000-0001-${index.toString().padStart(12, "0")}")
  (property "Sheetname" "Child ${index}" (at 20 19 0))
  (property "Sheetfile" "${file}" (at 20 41 0)))`

const schematic = (body = "") => `(kicad_sch
  (version 20250114) (generator "eeschema")
  (uuid "00000000-0000-0000-0000-000000000001")
  (paper "A4") (lib_symbols) ${body})`

test("an 18-file project explains that multi-file schematic import is unsupported", () => {
  const converter = new KicadToCircuitJsonConverter()
  const children = Array.from(
    { length: 17 },
    (_, index) => `child-${index}.kicad_sch`,
  )
  converter.addFile(
    "root.kicad_sch",
    schematic(children.map((file, index) => sheet(file, index)).join("\n")),
  )
  for (const file of children) converter.addFile(file, schematic())

  expect(() => converter.runUntilFinished()).toThrow(
    /Multi-file schematic projects are not supported yet[\s\S]*18/,
  )
  expect(converter.ctx).toBeUndefined()
})

test.each([
  "runUntilFinished",
  "step",
  "getOutput",
  "getOutputString",
] as const)("%s rejects root-only input before returning a partial circuit", (method) => {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "root.kicad_sch",
    schematic(sheet("children/power.kicad_sch") + sheet("driver.kicad_sch", 1)),
  )

  expect(() => converter[method]()).toThrow(
    /Hierarchical schematic import is not supported yet[\s\S]*root.kicad_sch[\s\S]*children\/power.kicad_sch[\s\S]*driver.kicad_sch/,
  )
  expect(converter.ctx).toBeUndefined()
  // Catching a failed conversion must not make a later getOutput() succeed
  // with an empty database left over from initialization.
  expect(() => converter.getOutput()).toThrow(/Hierarchical schematic import/)
})

test("a root with its own symbols also reports the omitted child sheets", () => {
  const converter = new KicadToCircuitJsonConverter()
  const content = readFileSync("tests/assets/hsp-usb-led.kicad_sch", "utf8")
  converter.addFile(
    "root.kicad_sch",
    content.replace(/\)\s*$/, `${sheet("child.kicad_sch")})`),
  )

  expect(() => converter.runUntilFinished()).toThrow(
    /Hierarchical schematic import[\s\S]*child.kicad_sch/,
  )
})

test("an intentionally empty standalone schematic still converts", () => {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("empty.kicad_sch", schematic())
  converter.runUntilFinished()
  expect(converter.getOutput()).toEqual([])
  expect(converter.getWarnings()).toEqual([])
})

test("a standalone schematic still imports its components and ports", () => {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "hsp-usb-led.kicad_sch",
    readFileSync("tests/assets/hsp-usb-led.kicad_sch", "utf8"),
  )
  converter.runUntilFinished()
  expect(
    converter
      .getOutput()
      .filter((element) => element.type === "source_component"),
  ).toHaveLength(12)
  expect(
    converter.getOutput().filter((element) => element.type === "source_port"),
  ).toHaveLength(23)
  expect(converter.getWarnings()).toEqual([])
})

test.each([
  ".kicad_pcb",
  ".kicad_sym",
])("retains the existing duplicate-file error for %s", (extension) => {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(`one${extension}`, "unused")
  converter.addFile(`two${extension}`, "unused")
  expect(() => converter.runUntilFinished()).toThrow(
    `Expected 0 or 1 file with extension ${extension}, got 2`,
  )
})
