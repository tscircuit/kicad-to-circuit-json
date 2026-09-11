import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { collectEvidence } from "./evidence"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
import {
  convertCircuitJsonToPcbSvg,
  convertCircuitJsonToSchematicSvg,
  CIRCUIT_TO_SVG_VERSION,
} from "circuit-to-svg"
import {
  KicadFootprintToCircuitJsonConverter,
  KicadToCircuitJsonConverter,
} from "../../../lib"

export const renderCases = [
  "roundrect-radius",
  "fabrication-text-ids",
  "standalone-source-port",
  "no-net-source-port",
  "schematic-text-anchor",
  "rounded-pads",
  "qfn60",
] as const
const standalone = (name: string) =>
  [
    "roundrect-radius",
    "fabrication-text-ids",
    "standalone-source-port",
  ].includes(name)
const sourceName = (name: string) =>
  standalone(name)
    ? "footprint.kicad_mod"
    : name === "no-net-source-port"
      ? "no-net.kicad_pcb"
      : name === "schematic-text-anchor"
        ? "centered-text.kicad_sch"
        : `${name}.kicad_pcb`
export const background = (name: string) =>
  name === "schematic-text-anchor" ? "#ffffff" : "#000000"
export const renderDir = join(import.meta.dir, "__snapshots__", "real-renders")
export const fixturePath = (name: string) =>
  join(import.meta.dir, "fixtures", sourceName(name))
export { CIRCUIT_TO_SVG_VERSION }

export function circuitRender(name: string) {
  const converter = standalone(name)
    ? new KicadFootprintToCircuitJsonConverter()
    : new KicadToCircuitJsonConverter()
  converter.addFile(sourceName(name), readFileSync(fixturePath(name), "utf8"))
  converter.runUntilFinished()
  const circuitJson = converter.getOutput()
  if (name === "schematic-text-anchor") {
    return {
      circuitJson,
      svg: convertCircuitJsonToSchematicSvg(circuitJson, {
        width: 1000,
        height: 900,
        includeVersion: false,
      }),
    }
  }
  const board = circuitJson.find((el) => el.type === "pcb_board")!
  const width = standalone(name)
    ? name === "fabrication-text-ids"
      ? 24
      : 10
    : name === "no-net-source-port"
      ? 8
      : board?.width
  const height = standalone(name)
    ? name === "fabrication-text-ids"
      ? 18
      : 8
    : name === "no-net-source-port"
      ? 8
      : board?.height
  if (width === undefined || height === undefined)
    throw new Error("Missing render bounds")
  // Match the KiCad export's visible layers: front copper/silkscreen and outline.
  const visible = circuitJson.filter(
    (el) =>
      (name === "fabrication-text-ids" ||
        !el.type.startsWith("pcb_fabrication_")) &&
      !el.type.startsWith("pcb_courtyard_"),
  )
  const svg = convertCircuitJsonToPcbSvg(visible, {
    width: 1000,
    height: 900,
    layer: "top",
    showCourtyards: false,
    showPcbNotes: name === "fabrication-text-ids",
    shouldDrawRatsNest: false,
    includeVersion: false,
    backgroundColor: "#000000",
    drawPaddingOutsideBoard: false,
    viewport: {
      minX: -width / 2,
      maxX: width / 2,
      minY: -height / 2,
      maxY: height / 2,
    },
  })
  return { svg, circuitJson }
}
export function exportKicad(name: string, destination: string) {
  const version = execFileSync("kicad-cli", ["version"], {
    encoding: "utf8",
    timeout: 10000,
  }).trim()
  const temp = mkdtempSync(join(tmpdir(), "kicad-render-"))
  try {
    if (name === "schematic-text-anchor") {
      execFileSync(
        "kicad-cli",
        [
          "sch",
          "export",
          "svg",
          fixturePath(name),
          "--exclude-drawing-sheet",
          "--black-and-white",
          "-o",
          temp,
        ],
        { timeout: 10000, stdio: "pipe" },
      )
      writeFileSync(destination, readFileSync(join(temp, "centered-text.svg")))
      return version
    }
    let input = fixturePath(name)
    if (standalone(name) || name === "no-net-source-port") {
      const outline = standalone(name)
        ? name === "fabrication-text-ids"
          ? "(start -12 -9) (end 12 9)"
          : "(start -5 -4) (end 5 4)"
        : "(start -4 -4) (end 4 4)"
      const rectangle = `(gr_rect ${outline} (stroke (width .05) (type default)) (fill none) (layer "Edge.Cuts"))`
      let source = readFileSync(input, "utf8")
      if (standalone(name)) {
        source = source
          .replace(/\(version \d+\)/, "")
          .replace(/\(generator [^)]+\)/, "")
          .replace('(layer "F.Cu")', '(layer "F.Cu") (at 0 0)')
        source = `(kicad_pcb (version 20241229) (generator pcbnew) (general (thickness 1.6)) (paper "A4") (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (35 "F.Paste" user) (37 "F.SilkS" user) (39 "F.Mask" user) (44 "Edge.Cuts" user) (49 "F.Fab" user)) (net 0 "") ${source} ${rectangle})`
      } else {
        source = source.trim().slice(0, -1) + rectangle + ")"
      }
      input = join(temp, "input.kicad_pcb")
      writeFileSync(input, source)
    }
    execFileSync(
      "kicad-cli",
      [
        "pcb",
        "export",
        "svg",
        input,
        "--layers",
        name === "fabrication-text-ids"
          ? "F.Cu,F.SilkS,F.Fab,Edge.Cuts"
          : "F.Cu,F.SilkS,Edge.Cuts",
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
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}
export async function pngFromSvg(svg: string, name: string) {
  // Display the native schematic at the same scale/origin as the renderer:
  // its 4.8 x 4.32 CJ viewport is 72 x 64.8 KiCad mm (15:1 conversion).
  // Only the SVG viewport changes for rasterization; raw native SVG is retained.
  if (name === "schematic-text-anchor" && svg.includes("Eeschema-SVG")) {
    svg = svg.replace(
      /width="[^"]+" height="[^"]+" viewBox="[^"]+"/,
      'width="1000" height="900" viewBox="69 116.1 72 64.8"',
    )
  }
  return sharp(Buffer.from(svg), { density: 200 })
    .resize(1000, 900, { fit: "contain", background: background(name) })
    .flatten({ background: background(name) })
    .png()
    .toBuffer()
}
export async function comparePngs(
  kicad: Buffer,
  circuitJson: Buffer,
  name: string,
) {
  // Only the neutral engine labels are drawn here. Every circuit pixel below
  // them comes from kicad-cli or circuit-to-svg, respectively.
  const evidence = collectEvidence().find((e) => e.name === name)
  const escape = (s: string) =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")
  const lines = evidence
    ? [
        evidence.title,
        `Expected: ${evidence.expected} | Imported: ${evidence.actual} | Assertion: ${evidence.passing ? "PASS" : "FAIL"}`,
        evidence.kind === "ids" || evidence.kind === "reference"
          ? "IDs and references are checked as data; their validity need not change PCB pixels."
          : evidence.kind === "pad"
            ? "Radius error: " +
              Math.abs(
                Number(evidence.values.actualRadius) -
                  Number(evidence.values.expectedRadius),
              ).toFixed(2) +
              " mm. Compare pad corners."
            : "Compare text centering against KiCad. Font and color differences remain.",
      ]
    : [
        name === "qfn60"
          ? "QFN-60 footprint: native library geometry"
          : "Four rounded pads: ratios 0.15, 0.25, 0.4, 0.5",
        "Inspect copper corners against KiCad. Font and silkscreen differences remain visible.",
      ]
  const footer = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="150"><rect width="2000" height="150" fill="#171d26"/><g fill="white" font-family="Arial, sans-serif" font-size="25">${lines.map((line, i) => `<text x="30" y="${37 + i * 40}">${escape(line)}</text>`).join("")}</g></svg>`,
  )
  const labels = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="72"><rect width="2000" height="72" fill="#171d26"/><g fill="white" font-family="Arial, sans-serif" font-size="28"><text x="30" y="46">KiCad</text><text x="1030" y="46">Circuit JSON</text></g></svg>`,
  )
  return sharp({
    create: { width: 2000, height: 1122, channels: 4, background: "#000000" },
  })
    .composite([
      { input: footer, left: 0, top: 972 },
      { input: labels, left: 0, top: 0 },
      { input: kicad, left: 0, top: 72 },
      { input: circuitJson, left: 1000, top: 72 },
    ])
    .png()
    .toBuffer()
}
