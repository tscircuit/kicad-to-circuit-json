import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { schematic_rect, schematic_sheet, schematic_text } from "circuit-json"
import { convertCircuitJsonToSchematicSvg } from "circuit-to-svg"
import { KicadToCircuitJsonConverter } from "../lib"

const UNIT_TO_MM = 10.16 / 1.1
const titleBlock = `(title_block (title "ECC Push-Pull") (date "Sat 21 Mar 2015")
  (rev "0.1") (company "Example Company")
  (comment 1 "Open hardware") (comment 4 "Preserve comment indices"))`

const convert = (
  paper = '(paper "A4")',
  fields = "",
  includeSchematicSheet?: boolean,
) => {
  const converter = new KicadToCircuitJsonConverter({ includeSchematicSheet })
  converter.addFile(
    "document.kicad_sch",
    `(kicad_sch (version 20250114) (generator eeschema)
      (uuid 9c6b5f7c-8b32-4b54-b004-3e5857f4d422)
      ${paper} ${fields} (lib_symbols))`,
  )
  converter.runUntilFinished()
  return converter
}

test.each([undefined, false])(
  "omits the whole title block when sheet output is %s",
  (includeSchematicSheet) => {
    const output = convert(
      '(paper "A4")',
      titleBlock,
      includeSchematicSheet,
    ).getOutput()
    expect(output).toEqual([])
    const svg = convertCircuitJsonToSchematicSvg(output)
    expect(svg).not.toContain("ECC Push-Pull")
    expect(svg).not.toContain('class="schematic-sheet"')
  },
)

test("title-block fields and border render from serialized Circuit JSON only with a sheet", () => {
  const converter = convert('(paper "A4")', titleBlock, true)
  const circuitJson = JSON.parse(converter.getOutputString())
  expect(circuitJson).toEqual(converter.getOutput())
  const output = converter.getOutput()
  const sheet = output.find((element) => element.type === "schematic_sheet")!
  expect(schematic_sheet.safeParse(sheet).success).toBe(true)
  const texts = output.filter((element) => element.type === "schematic_text")
  expect(texts.map((element) => element.text)).toEqual([
    "Title: ECC Push-Pull",
    "Date: Sat 21 Mar 2015",
    "Rev: 0.1",
    "Example Company",
    "Open hardware",
    "Preserve comment indices",
  ])
  for (const text of texts) {
    expect(schematic_text.safeParse(text).success).toBe(true)
    expect(text.schematic_component_id).toBeUndefined()
    expect(text.schematic_sheet_id).toBe(sheet.schematic_sheet_id)
  }
  // Sparse comment indices retain their worksheet rows, separated by 9 mm.
  expect(texts[5]!.position.y - texts[4]!.position.y).toBeCloseTo(
    9 / UNIT_TO_MM,
  )
  const border = output.find((element) => element.type === "schematic_rect")!
  expect(schematic_rect.safeParse(border).success).toBe(true)
  expect(border.schematic_sheet_id).toBe(sheet.schematic_sheet_id)
  expect(border.width).toBeCloseTo(108 / UNIT_TO_MM)
  expect(border.height).toBeCloseTo(32 / UNIT_TO_MM)
  for (const text of texts) {
    expect(text.position.x).toBeGreaterThan(border.center.x - border.width / 2)
    expect(text.position.x).toBeLessThan(border.center.x + border.width / 2)
    expect(text.position.y).toBeGreaterThan(border.center.y - border.height / 2)
    expect(text.position.y).toBeLessThan(border.center.y + border.height / 2)
  }
  expect(
    output.filter((element) => element.type === "schematic_line"),
  ).toHaveLength(6)
  const svg = convertCircuitJsonToSchematicSvg(circuitJson)
  expect(svg).toContain('class="schematic-sheet"')
  for (const text of texts) expect(svg).toContain(text.text)
})

test.each([
  ['(paper "A4")', 297, 210],
  ['(paper "A5")', 210, 148],
  ['(paper "A4" portrait)', 210, 297],
  ['(paper "USLetter")', 279.4, 215.9],
  ['(paper "User" 320 180 portrait)', 180, 320],
] as const)(
  "places the sheet and title block on the document paper %s",
  (paper, width, height) => {
    const output = convert(
      paper,
      '(title_block (title "Document") (rev "1"))',
      true,
    ).getOutput()
    const sheet = output.find((element) => element.type === "schematic_sheet")!
    expect(sheet.sheet_width).toBe(width)
    expect(sheet.sheet_height).toBe(height)
    const texts = output.filter((element) => element.type === "schematic_text")
    expect(texts[0]!.position.x).toBeCloseTo((width / 2 - 119) / UNIT_TO_MM)
    expect(texts[0]!.position.y).toBeCloseTo(-(height / 2 - 20.7) / UNIT_TO_MM)
    expect(texts[0]!.font_size).toBeCloseTo(2 / UNIT_TO_MM)
    expect(texts[1]!.position.x).toBeCloseTo((width / 2 - 34) / UNIT_TO_MM)
    expect(texts[1]!.position.y).toBeCloseTo(-(height / 2 - 16.9) / UNIT_TO_MM)
  },
)

test("absent and empty title-block fields do not create placeholder text", () => {
  for (const fields of [
    "",
    '(title_block (title "") (date "") (rev "") (company "") (comment 1 ""))',
  ]) {
    const output = convert('(paper "A4")', fields, true).getOutput()
    expect(
      output.filter((element) => element.type === "schematic_sheet"),
    ).toHaveLength(1)
    expect(
      output.filter((element) => element.type === "schematic_text"),
    ).toEqual([])
  }
})

test("the title-block border contains comments beyond the default four rows", () => {
  const output = convert(
    '(paper "A4")',
    '(title_block (comment 9 "Ninth comment"))',
    true,
  ).getOutput()
  const comment = output.find((element) => element.type === "schematic_text")!
  const border = output.find((element) => element.type === "schematic_rect")!
  expect(comment.text).toBe("Ninth comment")
  expect(comment.position.y).toBeLessThan(border.center.y + border.height / 2)
  expect(border.height).toBeCloseTo(47 / UNIT_TO_MM)
})

test("sheet selection retains the circuit while the default view keeps its existing coordinates", () => {
  const content = readFileSync("tests/assets/hsp-usb-led.kicad_sch", "utf8")
  const convertFixture = (includeSchematicSheet: boolean) => {
    const converter = new KicadToCircuitJsonConverter({ includeSchematicSheet })
    converter.addFile("hsp-usb-led.kicad_sch", content)
    converter.runUntilFinished()
    return converter.getOutput()
  }
  const circuitOnly = convertFixture(false)
  const withSheet = convertFixture(true)
  const sheet = withSheet.find((element) => element.type === "schematic_sheet")!
  const circuitComponents = circuitOnly.filter(
    (element) => element.type === "schematic_component",
  )
  const sheetComponents = withSheet.filter(
    (element) => element.type === "schematic_component",
  )
  expect(sheetComponents).toHaveLength(circuitComponents.length)
  expect(sheetComponents.length).toBeGreaterThan(0)
  for (const element of withSheet) {
    if (element.type.startsWith("schematic_")) {
      expect(
        "schematic_sheet_id" in element && element.schematic_sheet_id,
      ).toBe(sheet.schematic_sheet_id)
    } else {
      expect("schematic_sheet_id" in element).toBe(false)
    }
  }
  const sheetSvg = convertCircuitJsonToSchematicSvg(withSheet)
  expect(sheetSvg).toContain("Title: LED with USB-C")
  expect(sheetSvg).toContain("USB-C 2.0")
  const circuitSvg = convertCircuitJsonToSchematicSvg(circuitOnly)
  expect(circuitSvg).not.toContain("Title: LED with USB-C")
  expect(circuitSvg).not.toContain('class="schematic-sheet"')
  expect(circuitSvg).toContain("USB-C 2.0")
  // The default view still uses the existing inverse conversion at (105, 148.5).
  const nativePosition = { x: 128.27, y: 118.11 }
  expect(circuitComponents[0]!.center.x).toBeCloseTo(
    (nativePosition.x - 105) / 15,
  )
  expect(circuitComponents[0]!.center.y).toBeCloseTo(
    -(nativePosition.y - 148.5) / 15,
  )
})
