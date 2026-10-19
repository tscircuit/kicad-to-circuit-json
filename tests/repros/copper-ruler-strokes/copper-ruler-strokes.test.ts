import { expect, test } from "bun:test"
import "bun-match-svg"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseKicadPcb } from "kicadts"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import {
  KicadFootprintToCircuitJsonConverter,
  KicadToCircuitJsonConverter,
  upgradeKicad5FootprintToKicad6,
} from "../../../lib"

const fixturePath = join(
  import.meta.dir,
  "Gauge_50mm_Type2_CopperTop.kicad_mod",
)

function makeRulerBoard(footprint: string) {
  const placedFootprint = upgradeKicad5FootprintToKicad6(footprint).replace(
    "(at 0 0)",
    "(at 0 0) (tstamp d3fc9057-d323-46af-a8de-8d7590990ac4)",
  )
  return `(kicad_pcb (version 20171130) (generator pcbnew)
    (general (thickness 1.6))
    (paper "A4")
    (layers (0 F.Cu signal) (31 B.Cu signal) (37 F.SilkS user)
      (44 Edge.Cuts user) (49 F.Fab user))
    ${placedFootprint}
    (gr_line (start -7 -55) (end 55 -55) (layer Edge.Cuts) (width 0.05))
    (gr_line (start 55 -55) (end 55 14) (layer Edge.Cuts) (width 0.05))
    (gr_line (start 55 14) (end -7 14) (layer Edge.Cuts) (width 0.05))
    (gr_line (start -7 14) (end -7 -55) (layer Edge.Cuts) (width 0.05))
  )`
}

test("real KiCad copper ruler loses all 41 footprint strokes", async () => {
  const footprint = await readFile(fixturePath, "utf8")
  expect(createHash("sha256").update(footprint).digest("hex")).toBe(
    "05cc439b1389ffb2874ea342238d5337552d9ba39e7067200edaa605dd433492",
  )
  const boardSource = makeRulerBoard(footprint)
  const sourceLines = parseKicadPcb(boardSource).footprints[0]!.fpLines
  expect(sourceLines).toHaveLength(41)
  for (const line of sourceLines) {
    expect(line.layer?.names).toEqual(["F.Cu"])
    expect(line.stroke?.width ?? line.width).toBeCloseTo(0.381)
  }

  const boardConverter = new KicadToCircuitJsonConverter()
  boardConverter.addFile("copper-ruler.kicad_pcb", boardSource)
  boardConverter.runUntilFinished()
  const footprintConverter = new KicadFootprintToCircuitJsonConverter()
  footprintConverter.addFile("copper-ruler.kicad_mod", footprint)
  footprintConverter.runUntilFinished()

  for (const converter of [boardConverter, footprintConverter]) {
    const output = converter.getOutput()
    expect(
      output.filter((element) => element.type === "pcb_component"),
    ).toHaveLength(1)
    expect(converter.getWarnings()).toEqual([])
    const copper = output.filter((element) =>
      [
        "pcb_smtpad",
        "pcb_trace",
        "pcb_plated_hole",
        "pcb_copper_pour",
      ].includes(element.type),
    )
    // Reproduction baseline: import succeeds, but none of the source copper survives.
    // The stacked fix replaces this with checks for all 41 physical strokes.
    expect(copper).toHaveLength(0)
  }

  const tempDir = await mkdtemp(join(tmpdir(), "kicad-copper-ruler-"))
  try {
    const boardPath = join(tempDir, "ruler.kicad_pcb")
    const svgPath = join(tempDir, "ruler.svg")
    await writeFile(boardPath, boardSource)
    execFileSync("kicad-cli", [
      "pcb",
      "export",
      "svg",
      boardPath,
      "-o",
      svgPath,
      "--layers",
      "F.Cu,Edge.Cuts",
      "--mode-single",
      "--page-size-mode",
      "2",
      "--exclude-drawing-sheet",
    ])
    const sourceSvg = (await readFile(svgPath, "utf8")).replace(
      /<title>[\s\S]*?<\/title>/,
      "<title>KiCad copper ruler</title>",
    )
    const importedSvg = convertCircuitJsonToPcbSvg(
      boardConverter
        .getOutput()
        .filter((element) =>
          [
            "pcb_board",
            "pcb_smtpad",
            "pcb_trace",
            "pcb_plated_hole",
            "pcb_copper_pour",
          ].includes(element.type),
        ),
      {
        width: 600,
        height: 668,
        drawPaddingOutsideBoard: false,
        includeVersion: false,
      },
    )
    const dataUrl = (svg: string) =>
      `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
    const comparison = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="750" viewBox="0 0 1200 750">
      <rect width="1200" height="750" fill="#111820"/>
      <g fill="white" font-family="sans-serif">
        <text x="20" y="30" font-size="22">KiCad source: real 50 mm copper ruler</text>
        <text x="620" y="30" font-size="22">Imported PCB: copper strokes missing</text>
        <text x="20" y="60" font-size="16">41 original copper strokes, 0.381 mm wide</text>
        <text x="620" y="60" font-size="16">Import succeeds without a warning</text>
      </g>
      <image x="0" y="82" width="600" height="668" href="${dataUrl(sourceSvg)}"/>
      <image x="600" y="82" width="600" height="668" href="${dataUrl(importedSvg)}"/>
    </svg>`
    await expect(comparison).toMatchSvgSnapshot(import.meta.path)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}, 30_000)
