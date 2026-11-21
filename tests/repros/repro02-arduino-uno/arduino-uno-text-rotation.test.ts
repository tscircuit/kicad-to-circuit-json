import { beforeAll, expect, test } from "bun:test"
import "bun-match-svg"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { createSideBySideSvg } from "../../fixtures/create-side-by-side-svg"

const converter = new KicadToCircuitJsonConverter()

beforeAll(async () => {
  converter.addFile(
    "arduino-uno.kicad_pcb",
    readFileSync(join(import.meta.dir, "arduino-uno.source.kicad_pcb"), "utf8"),
  )
  converter.runUntilFinished()

  const nativeSvg = readFileSync(
    join(import.meta.dir, "arduino-uno-fabrication.native.svg"),
    "utf8",
  )
  const convertedSvg = convertCircuitJsonToPcbSvg(
    converter
      .getOutput()
      .filter(
        (element) =>
          element.type === "pcb_board" ||
          element.type.startsWith("pcb_fabrication_note"),
      ),
    {
      width: 1000,
      height: 800,
      includeVersion: false,
      viewport: { minX: -40, maxX: 40, minY: -32, maxY: 32 },
    },
  )
  const comparison = createSideBySideSvg(nativeSvg, convertedSvg)
  await expect(
    `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="840"><rect width="100%" height="100%" fill="black"/><g fill="white" font-family="sans-serif" font-size="22"><text x="20" y="28">Native KiCad — original Arduino Uno fabrication layers</text><text x="1020" y="28">Converted fabrication layers</text></g><g transform="translate(0 40)">${comparison}</g></svg>`,
  ).toMatchSvgSnapshot(import.meta.path)
}, 30_000)

test.failing("Arduino Uno preserves text angles and KiCad keep-upright behavior", () => {
  const fabricationTexts = converter
    .getOutput()
    .filter((element) => element.type === "pcb_fabrication_note_text")
  const silkscreenTexts = converter
    .getOutput()
    .filter((element) => element.type === "pcb_silkscreen_text")

  expect(
    fabricationTexts.find((text) => text.text === "ATMEGA16U2-MU")
      ?.ccw_rotation,
  ).toBe(90)
  expect(
    fabricationTexts.find((text) => text.text === "GREEN")?.ccw_rotation ?? 0,
  ).toBe(0)
  expect(
    fabricationTexts.find((text) => text.text === "C5")?.ccw_rotation,
  ).toBe(90)
  expect(
    fabricationTexts.find((text) => text.text === "USB_C_Receptacle_USB2.0_16P")
      ?.ccw_rotation,
  ).toBe(270)
  expect(
    fabricationTexts.find((text) => text.text === "PCB Edge")?.ccw_rotation,
  ).toBe(270)
  expect(
    silkscreenTexts.find((text) => text.text === "Y2")?.ccw_rotation ?? 0,
  ).toBe(0)
})
