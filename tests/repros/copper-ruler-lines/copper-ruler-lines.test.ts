import { expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { parseKicadPcb } from "kicadts"
import sharp from "sharp"
import {
  KicadFootprintToCircuitJsonConverter,
  KicadToCircuitJsonConverter,
} from "../../../lib"
import "../../fixtures/png-matcher"

const boardPath = join(import.meta.dir, "copper-ruler.kicad_pcb")
const boardSource = await readFile(boardPath, "utf8")
const footprintSource = await readFile(
  join(import.meta.dir, "Gauge_50mm_Type2_CopperTop.kicad_mod"),
  "utf8",
)
const sourceLines = parseKicadPcb(boardSource).footprints[0]!.fpLines

// Conversion runs outside test.failing so parser/import exceptions cannot
// accidentally satisfy the expected geometry failure.
const boardConverter = new KicadToCircuitJsonConverter()
boardConverter.addFile("copper-ruler.kicad_pcb", boardSource)
boardConverter.runUntilFinished()
const footprintConverter = new KicadFootprintToCircuitJsonConverter()
footprintConverter.addFile("ruler.kicad_mod", footprintSource)
footprintConverter.runUntilFinished()

function copperElements(output: AnyCircuitElement[]) {
  return output.filter(
    (element) =>
      element.type === "pcb_smtpad" ||
      element.type === "pcb_trace" ||
      element.type === "pcb_copper_pour" ||
      element.type === "pcb_plated_hole",
  )
}

test("public ruler fixture contains 41 copper strokes and both imports complete", () => {
  expect(sourceLines).toHaveLength(41)
  for (const line of sourceLines) {
    expect(line.layer?.names).toEqual(["F.Cu"])
    expect(line.stroke?.width ?? line.width).toBeCloseTo(0.381)
  }
  for (const converter of [boardConverter, footprintConverter]) {
    expect(
      converter
        .getOutput()
        .filter((element) => element.type === "pcb_component"),
    ).toHaveLength(1)
  }
})

for (const [mode, converter] of [
  ["board", boardConverter],
  ["standalone footprint", footprintConverter],
] as const) {
  test.failing(`${mode}: ruler copper survives import`, () => {
    // All 41 source strokes currently disappear, with no import warning.
    // Accept any supported copper representation rather than prescribing a fix.
    expect(copperElements(converter.getOutput()).length).toBeGreaterThan(0)
  })
}

test("ruler: native KiCad copper beside converted copper at the same scale", async () => {
  const temporaryDir = await mkdtemp(join(tmpdir(), "copper-ruler-"))
  try {
    const temporaryBoardPath = join(temporaryDir, "ruler.kicad_pcb")
    await writeFile(temporaryBoardPath, boardSource)
    const svgPath = join(temporaryDir, "ruler.svg")
    execFileSync("kicad-cli", [
      "pcb",
      "export",
      "svg",
      temporaryBoardPath,
      "-o",
      svgPath,
      "--layers",
      "F.Cu",
      "--mode-single",
      "--page-size-mode",
      "2",
      "--exclude-drawing-sheet",
    ])
    // KiCad rounds page extents; use the fixture's exact 62 x 68 mm outline.
    // Only the viewport changes: all copper paths come from KiCad itself.
    const nativeSvg = (await readFile(svgPath, "utf8")).replace(
      /width="[^"]+" height="[^"]+" viewBox="[^"]+"/,
      'width="620" height="680" viewBox="0 0 62 68"',
    )
    expect(nativeSvg).toContain('viewBox="0 0 62 68"')
    const output = boardConverter.getOutput()
    const importedSvg = convertCircuitJsonToPcbSvg(
      [
        ...output.filter((element) => element.type === "pcb_board"),
        ...copperElements(output),
      ],
      {
        width: 620,
        height: 680,
        drawPaddingOutsideBoard: false,
        showSolderMask: false,
        includeVersion: false,
        backgroundColor: "#000000",
      },
    )
    const labelSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="740">
      <rect width="1240" height="740" fill="#101923"/>
      <g fill="white" font-family="sans-serif" font-size="22">
        <text x="16" y="36">KiCad F.Cu: 41 ruler strokes</text>
        <text x="636" y="36">Imported copper</text>
      </g>
    </svg>`
    const comparison = await sharp(Buffer.from(labelSvg))
      .composite([
        {
          input: await sharp(Buffer.from(nativeSvg))
            .flatten({ background: "#000000" })
            .png()
            .toBuffer(),
          left: 0,
          top: 60,
        },
        {
          input: await sharp(Buffer.from(importedSvg)).png().toBuffer(),
          left: 620,
          top: 60,
        },
      ])
      .png()
      .toBuffer()
    await expect(comparison).toMatchPngSnapshot(
      import.meta.path,
      "copper-ruler-lines",
    )
  } finally {
    await rm(temporaryDir, { recursive: true, force: true })
  }
}, 30_000)
