import { expect, test } from "bun:test"
import "bun-match-svg"
import { $ } from "bun"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { parseKicadMod } from "kicadts"
import {
  KicadFootprintToCircuitJsonConverter,
  KicadToCircuitJsonConverter,
} from "../../../lib"
import { createSideBySideSvg } from "../../fixtures/create-side-by-side-svg"

const fixturePath = join(import.meta.dir, "antmicro-logo.kicad_mod")
const source = readFileSync(fixturePath, "utf8")

function makeLogoBoard() {
  return `(kicad_pcb (version 20241229) (generator pcbnew)
    (general (thickness 1.6))
    (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
    ${source}
    (gr_rect (start 206.5 143.463) (end 219.5 146.463)
      (stroke (width 0.05) (type solid)) (fill none) (layer "Edge.Cuts"))
  )`
}

function importLogo() {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("antmicro-logo.kicad_pcb", makeLogoBoard())
  converter.runUntilFinished()
  return converter
}

test("snapshot: Antmicro copper circles compared with native KiCad", async () => {
  const converter = importLogo()
  const output = converter.getOutput()
  const copper = output.filter((element) =>
    ["pcb_board", "pcb_smtpad", "pcb_trace", "pcb_copper_pour"].includes(
      element.type,
    ),
  )
  const annuli = copper.filter(
    (element) => element.type === "pcb_copper_pour" && element.shape === "brep",
  )
  const importedSvg = convertCircuitJsonToPcbSvg(copper, {
    width: 700,
    height: 210,
    matchBoardAspectRatio: true,
    drawPaddingOutsideBoard: false,
    showSolderMask: false,
    includeVersion: false,
  })
  const tempDir = await mkdtemp(join(tmpdir(), "kicad-copper-circles-"))
  try {
    const boardPath = join(tempDir, "logo.kicad_pcb")
    const svgPath = join(tempDir, "logo.svg")
    await writeFile(boardPath, makeLogoBoard())
    await $`kicad-cli pcb export svg ${boardPath} -o ${svgPath} --layers F.Cu,Edge.Cuts --mode-single --page-size-mode 2 --exclude-drawing-sheet`.quiet()
    const nativeSvg = await readFile(svgPath, "utf8")
    const comparison = createSideBySideSvg(nativeSvg, importedSvg)
    const snapshot = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="300" viewBox="0 0 1400 300">
      <rect width="100%" height="100%" fill="#111820"/>
      <g fill="white" font-family="sans-serif">
        <text x="20" y="30" font-size="22">Native KiCad: nine polygons + eight copper circles</text>
        <text x="720" y="30" font-size="22">Imported: ${annuli.length}/8 copper circles</text>
        <text x="20" y="60" font-size="16">All eight circles: fill none, stroke width 0.13 mm, F.Cu</text>
        <text x="720" y="60" font-size="16">Connecting line strokes are tracked separately in #267</text>
      </g>
      <g transform="translate(0 85)">${comparison}</g>
    </svg>`
    await expect(snapshot).toMatchSvgSnapshot(
      import.meta.path,
      "antmicro-copper-circles",
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test("preserve all eight real copper circle strokes in board and standalone imports", () => {
  expect(createHash("sha256").update(source).digest("hex")).toBe(
    "849217fe122c34973e70e0628175dd17f304c347745b6148cbbb70d25b307238",
  )
  const footprint = parseKicadMod(source)
  const sourceCircles = footprint.fpCircles.filter((circle) =>
    circle.layer?.names.includes("F.Cu"),
  )
  expect(sourceCircles).toHaveLength(8)
  expect(
    footprint.fpPolys.filter((poly) => poly.layer?.names.includes("F.Cu")),
  ).toHaveLength(9)
  const standalone = new KicadFootprintToCircuitJsonConverter()
  standalone.addFile("logo.kicad_mod", source)
  standalone.runUntilFinished()

  for (const converter of [importLogo(), standalone]) {
    const output = converter.getOutput()
    expect(
      output.filter(
        (element) =>
          element.type === "pcb_smtpad" && element.shape === "polygon",
      ),
    ).toHaveLength(9)
    const annuli = output.filter(
      (element) =>
        element.type === "pcb_copper_pour" && element.shape === "brep",
    )
    expect(annuli).toHaveLength(8)
    for (const [index, annulus] of annuli.entries()) {
      if (annulus.type !== "pcb_copper_pour" || annulus.shape !== "brep")
        throw new Error("Expected circular copper artwork")
      const circle = sourceCircles[index]!
      const radius = Math.hypot(
        circle.end!.x - circle.center!.x,
        circle.end!.y - circle.center!.y,
      )
      const center = {
        x: footprint.position!.x + circle.center!.x,
        y: footprint.position!.y + circle.center!.y,
      }
      const mat = converter.ctx!.k2cMatPcb!
      const cx = mat.a * center.x + mat.c * center.y + mat.e
      const cy = mat.b * center.x + mat.d * center.y + mat.f
      expect(annulus.layer).toBe("top")
      expect(annulus.covered_with_solder_mask).toBe(true)
      expect(annulus.brep_shape.inner_rings).toHaveLength(1)
      for (const [ring, expectedRadius] of [
        [annulus.brep_shape.outer_ring, radius + 0.065],
        [annulus.brep_shape.inner_rings[0]!, radius - 0.065],
      ] as const) {
        for (const vertex of ring.vertices) {
          expect(Math.hypot(vertex.x - cx, vertex.y - cy)).toBeCloseTo(
            expectedRadius,
            8,
          )
        }
      }
    }
  }
})
