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
    /\(at [^)]+\)/,
    "$& (tstamp d3fc9057-d323-46af-a8de-8d7590990ac4)",
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

test("real KiCad copper ruler preserves all 41 footprint strokes", async () => {
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

  for (const [converter, boardCenter] of [
    [boardConverter, { x: 24, y: -20.5 }],
    [footprintConverter, { x: 0, y: 0 }],
  ] as const) {
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
    expect(copper).toHaveLength(41)
    const component = output.find(
      (element) => element.type === "pcb_component",
    )!
    for (const [index, stroke] of copper.entries()) {
      expect(stroke.type).toBe("pcb_smtpad")
      if (stroke.type !== "pcb_smtpad")
        throw new Error("Expected copper artwork")
      expect(stroke.shape).toBe("rotated_pill")
      if (stroke.shape !== "rotated_pill")
        throw new Error("Expected round caps")
      const source = sourceLines[index]!
      const dx = source.end!.x - source.start!.x
      const dy = source.start!.y - source.end!.y
      expect(stroke.x).toBeCloseTo(
        (source.start!.x + source.end!.x) / 2 - boardCenter.x,
        6,
      )
      expect(stroke.y).toBeCloseTo(
        boardCenter.y - (source.start!.y + source.end!.y) / 2,
        6,
      )
      expect(stroke.width).toBeCloseTo(Math.hypot(dx, dy) + 0.381, 6)
      expect(stroke.height).toBeCloseTo(0.381, 6)
      expect(stroke.radius).toBeCloseTo(0.381 / 2, 6)
      expect(stroke.ccw_rotation).toBeCloseTo(
        (Math.atan2(dy, dx) * 180) / Math.PI,
        6,
      )
      expect(stroke.layer).toBe("top")
      expect(stroke.pcb_component_id).toBe(component.pcb_component_id)
      expect(stroke.pcb_port_id).toBeUndefined()
      expect(stroke.is_covered_with_solder_mask).toBe(true)
    }
  }

  // Place the same real ruler on either copper face at orthogonal and oblique angles.
  for (const [layer, angle] of [
    ["F.Cu", 90],
    ["F.Cu", 180],
    ["B.Cu", 37],
    ["B.Cu", 270],
  ] as const) {
    const placedSource = footprint
      .replaceAll("(layer F.Cu)", `(layer ${layer})`)
      .replace("(at 0 0)", `(at 18 11 ${angle})`)
    const converter = new KicadToCircuitJsonConverter()
    converter.addFile("placed-ruler.kicad_pcb", makeRulerBoard(placedSource))
    converter.runUntilFinished()
    const strokes = converter
      .getOutput()
      .filter((element) => element.type === "pcb_smtpad")
    expect(strokes).toHaveLength(41)
    const radians = (angle * Math.PI) / 180
    for (const [index, stroke] of strokes.entries()) {
      if (stroke.shape !== "rotated_pill")
        throw new Error("Expected copper stroke")
      const line = sourceLines[index]!
      const localX = (line.start!.x + line.end!.x) / 2
      const localY = (line.start!.y + line.end!.y) / 2
      expect(stroke.x).toBeCloseTo(
        localX * Math.cos(radians) + localY * Math.sin(radians) + 18 - 24,
        6,
      )
      expect(stroke.y).toBeCloseTo(
        localX * Math.sin(radians) - localY * Math.cos(radians) - 11 - 20.5,
        6,
      )
      const sourceAngle =
        (Math.atan2(line.start!.y - line.end!.y, line.end!.x - line.start!.x) *
          180) /
        Math.PI
      const delta =
        ((stroke.ccw_rotation - sourceAngle - angle) * Math.PI) / 180
      expect(Math.cos(delta)).toBeCloseTo(1, 6)
      expect(Math.sin(delta)).toBeCloseTo(0, 6)
      expect(stroke.layer).toBe(layer === "F.Cu" ? "top" : "bottom")
      expect(stroke.height).toBeCloseTo(0.381, 6)
    }
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
        <text x="620" y="30" font-size="22">Imported PCB: 41 copper strokes preserved</text>
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
