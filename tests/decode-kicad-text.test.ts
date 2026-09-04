import { expect, test } from "bun:test"
import {
  decodeKicadText,
  parseKicadText,
} from "../lib/stages/schematic/utils/decodeKicadText"

test("extracts KiCad overline ranges without including suffixes", () => {
  expect(parseKicadText("~{RTS}")).toEqual({
    text: "RTS",
    overlineRanges: [{ start: 0, end: 3 }],
  })
  expect(parseKicadText("~{RXT}/GPIO.1")).toEqual({
    text: "RXT/GPIO.1",
    overlineRanges: [{ start: 0, end: 3 }],
  })
})

test("preserves malformed overline markup", () => {
  expect(decodeKicadText("~{RESET")).toBe("~{RESET")
})

test("decodes KiCad slash escapes", () => {
  expect(decodeKicadText("USB{slash}D+")).toBe("USB/D+")
})
