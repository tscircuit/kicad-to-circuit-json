import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import sharp from "sharp"
import {
  convertCircuitJsonToPcbSvg,
  CIRCUIT_TO_SVG_VERSION,
} from "circuit-to-svg"
import { KicadToCircuitJsonConverter } from "../../../lib"

export const renderCases = ["rounded-pads", "qfn60"] as const
export const renderDir = join(import.meta.dir, "__snapshots__", "real-renders")
export const fixturePath = (name: string) =>
  join(import.meta.dir, "fixtures", `${name}.kicad_pcb`)
export { CIRCUIT_TO_SVG_VERSION }

export function circuitRender(name: string) {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    `${name}.kicad_pcb`,
    readFileSync(fixturePath(name), "utf8"),
  )
  converter.runUntilFinished()
  const circuitJson = converter.getOutput()
  const board = circuitJson.find((el) => el.type === "pcb_board")!
  if (!board || board.width === undefined || board.height === undefined)
    throw new Error("Render fixture must contain a board outline")
  // Match the KiCad export's visible layers: front copper/silkscreen and outline.
  const visible = circuitJson.filter(
    (el) =>
      !el.type.startsWith("pcb_fabrication_") &&
      !el.type.startsWith("pcb_courtyard_"),
  )
  const svg = convertCircuitJsonToPcbSvg(visible, {
    width: 1000,
    height: 900,
    layer: "top",
    showCourtyards: false,
    shouldDrawRatsNest: false,
    includeVersion: false,
    backgroundColor: "#000000",
    drawPaddingOutsideBoard: false,
    viewport: {
      minX: -board.width / 2,
      maxX: board.width / 2,
      minY: -board.height / 2,
      maxY: board.height / 2,
    },
  })
  return { svg, circuitJson }
}
export function exportKicad(name: string, destination: string) {
  const version = execFileSync("kicad-cli", ["version"], {
    encoding: "utf8",
    timeout: 10000,
  }).trim()
  execFileSync(
    "kicad-cli",
    [
      "pcb",
      "export",
      "svg",
      fixturePath(name),
      "--layers",
      "F.Cu,F.SilkS,Edge.Cuts",
      "--mode-single",
      "--page-size-mode",
      "2",
      "--exclude-drawing-sheet",
      "-o",
      destination,
    ],
    { timeout: 10000, stdio: "pipe" },
  )
  return version
}
export async function pngFromSvg(svg: string) {
  return sharp(Buffer.from(svg), { density: 200 })
    .resize(1000, 900, { fit: "contain", background: "#000000" })
    .flatten({ background: "#000000" })
    .png()
    .toBuffer()
}
export async function comparePngs(kicad: Buffer, circuitJson: Buffer) {
  // Only the neutral engine labels are drawn here. Every circuit pixel below
  // them comes from kicad-cli or circuit-to-svg, respectively.
  const labels = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="72"><rect width="2000" height="72" fill="#171d26"/><g fill="white" font-family="Arial, sans-serif" font-size="28"><text x="30" y="46">KiCad</text><text x="1030" y="46">Circuit JSON</text></g></svg>`,
  )
  return sharp({
    create: { width: 2000, height: 972, channels: 4, background: "#000000" },
  })
    .composite([
      { input: labels, left: 0, top: 0 },
      { input: kicad, left: 0, top: 72 },
      { input: circuitJson, left: 1000, top: 72 },
    ])
    .png()
    .toBuffer()
}
