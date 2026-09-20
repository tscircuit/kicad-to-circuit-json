import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parseKicadSch } from "kicadts"
import sharp from "sharp"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { stackCircuitJsonKicadPngs } from "../../fixtures/stackCircuitJsonKicadPngs"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"
import "../../fixtures/png-matcher"

const previewWidth = 1200
const previewHeight = 800

const renderPreview = async (svg: Buffer | string): Promise<Buffer> => {
  const rendered = await sharp(
    typeof svg === "string" ? Buffer.from(svg) : svg,
    { density: 192 },
  )
    .flatten({ background: "#F5F4EF" })
    .png()
    .toBuffer()
  const trimmed = await sharp(rendered)
    .trim({ background: "#F5F4EF", threshold: 10 })
    .png()
    .toBuffer()

  return sharp(trimmed)
    .extend({
      top: 20,
      bottom: 20,
      left: 20,
      right: 20,
      background: "#F5F4EF",
    })
    .resize({
      width: previewWidth,
      height: previewHeight,
      fit: "contain",
      background: "#F5F4EF",
    })
    .png()
    .toBuffer()
}

test("reproduces the rotated mirrored GND graphic direction mismatch", async () => {
  const schematicPath = new URL(
    "../../assets/mipi-rotated-mirrored-gnd.kicad_sch",
    import.meta.url,
  )
  const schematicContent = readFileSync(schematicPath, "utf8")
  const schematic = parseKicadSch(schematicContent)
  const gndInstance = schematic.symbols.find(
    (symbol) => symbol.uuid === "00000000-0000-0000-0000-000068d50852",
  )

  expect(gndInstance).toBeDefined()
  expect({
    angle: gndInstance?.at?.angle,
    mirror: gndInstance?.mirror,
  }).toEqual({ angle: 270, mirror: "x" })

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("mipi-rotated-mirrored-gnd.kicad_sch", schematicContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  const gndSchematicComponent = circuitJson.find(
    (element) =>
      element.type === "schematic_component" &&
      element.symbol_display_value === "GND" &&
      Math.abs(element.center.x + 4.46) < 1e-9 &&
      Math.abs(element.center.y - 1.264) < 1e-9,
  )
  if (gndSchematicComponent?.type !== "schematic_component") {
    throw new Error("Expected the affected MIPI GND schematic component")
  }

  const gndPort = circuitJson.find(
    (element) =>
      element.type === "schematic_port" &&
      element.schematic_component_id ===
        gndSchematicComponent.schematic_component_id,
  )
  if (gndPort?.type !== "schematic_port") {
    throw new Error("Expected the GND schematic port")
  }

  const gndPath = circuitJson.find(
    (element) =>
      element.type === "schematic_path" &&
      element.schematic_component_id ===
        gndSchematicComponent.schematic_component_id,
  )
  if (gndPath?.type !== "schematic_path") {
    throw new Error("Expected the GND schematic path")
  }

  const pathXs = gndPath.points.map((point) => point.x)
  const graphicDirection =
    Math.max(...pathXs) > gndPort.center.x ? "right" : "left"

  expect({
    graphicDirection,
    portFacingDirection: gndPort.facing_direction,
  }).toMatchSnapshot()

  const snapshotDirectory = new URL("./__snapshots__/", import.meta.url)
  const fs = await import("node:fs/promises")
  await fs.mkdir(snapshotDirectory, { recursive: true })

  const { convertCircuitJsonToSchematicSvg } = await import("circuit-to-svg")
  const circuitJsonSvg = convertCircuitJsonToSchematicSvg(circuitJson, {
    width: previewWidth,
    height: previewHeight,
  })
    .replaceAll("sans-serif", "Arial, sans-serif")
    .replace(/[ \t]+$/gm, "")
  await fs.writeFile(
    new URL(
      "rotated-mirrored-symbol-graphics-circuit-json.svg",
      snapshotDirectory,
    ),
    circuitJsonSvg,
  )

  const kicadSnapshot = await takeKicadSnapshot({
    kicadFilePath: fileURLToPath(schematicPath),
    kicadFileType: "sch",
    generatePng: false,
    excludeDrawingSheet: true,
  })
  const kicadSvg = Object.values(kicadSnapshot.generatedFileContent)[0]
  if (!kicadSvg) throw new Error("Expected a KiCad schematic snapshot")

  const [circuitJsonPng, kicadPng] = await Promise.all([
    renderPreview(circuitJsonSvg),
    renderPreview(kicadSvg),
  ])
  const stackedPng = await stackCircuitJsonKicadPngs(circuitJsonPng, kicadPng)

  await expect(stackedPng).toMatchPngSnapshot(
    import.meta.path,
    "rotated-mirrored-symbol-graphics",
  )
}, 30_000)
