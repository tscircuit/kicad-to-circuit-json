import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import sharp from "sharp"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { stackCircuitJsonKicadPngs } from "../../fixtures/stackCircuitJsonKicadPngs"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"
import "../../fixtures/png-matcher"

test("Easyduino schematic converts active-low pin labels", async () => {
  const schematicPath = new URL(
    "../../assets/Easyduino_ESP32.kicad_sch",
    import.meta.url,
  )
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "Easyduino_ESP32.kicad_sch",
    readFileSync(schematicPath, "utf-8"),
  )
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  expect(circuitJson.length).toBeGreaterThan(0)

  expect(circuitJson).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "schematic_text",
        text: "RI/CLK",
        text_parts: [{ text: "RI", is_overlined: true }, { text: "/CLK" }],
      }),
      expect.objectContaining({
        type: "source_port",
        pin_number: 11,
        name: "N_SUSPEND",
      }),
      expect.objectContaining({
        type: "source_port",
        pin_number: 12,
        name: "SUSPEND",
      }),
      expect.objectContaining({
        type: "schematic_text",
        text: "SUSPEND",
        color: "rgb(0, 100, 100)",
        text_parts: [{ text: "SUSPEND", is_overlined: true }],
      }),
      expect.objectContaining({
        type: "schematic_text",
        text: "SUSPEND",
        color: "rgb(15, 15, 15)",
        text_parts: [{ text: "SUSPEND", is_overlined: true }],
      }),
    ]),
  )

  const fs = await import("node:fs/promises")
  const snapshotDirectory = new URL("./__snapshots__/", import.meta.url)
  await fs.mkdir(snapshotDirectory, { recursive: true })
  await fs.writeFile(
    new URL("easyduino-overline-circuit-json.json", snapshotDirectory),
    JSON.stringify(circuitJson, null, 2),
  )

  const kicadSnapshot = await takeKicadSnapshot({
    kicadFilePath: fileURLToPath(schematicPath),
    kicadFileType: "sch",
    generatePng: false,
  })
  const kicadSvg = Object.values(kicadSnapshot.generatedFileContent)[0]
  if (!kicadSvg) throw new Error("Expected KiCad schematic snapshot")

  const { convertCircuitJsonToSchematicSvg } = await import("circuit-to-svg")
  const circuitJsonSvg = convertCircuitJsonToSchematicSvg(circuitJson as any, {
    width: 700,
    height: 800,
  }).replaceAll("sans-serif", "Arial, sans-serif")
  await fs.writeFile(
    new URL("easyduino-overline-circuit-json.svg", snapshotDirectory),
    circuitJsonSvg,
  )

  const snapshotDensity = 144
  const [circuitJsonPng, kicadPng] = await Promise.all([
    sharp(Buffer.from(circuitJsonSvg), { density: snapshotDensity })
      .png()
      .toBuffer(),
    sharp(kicadSvg, { density: snapshotDensity }).png().toBuffer(),
  ])
  const stackedPng = await stackCircuitJsonKicadPngs(circuitJsonPng, kicadPng)

  await expect(stackedPng).toMatchPngSnapshot(
    import.meta.path,
    "easyduino-overline",
  )
}, 30_000)
