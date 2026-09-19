import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import sharp from "sharp"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { stackCircuitJsonKicadPngs } from "../../fixtures/stackCircuitJsonKicadPngs"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"
import "../../fixtures/png-matcher"

test("preserves the USB connector symbol arcs", async () => {
  const schematicPath = new URL(
    "../../assets/usb-symbol-primitive-layering.kicad_sch",
    import.meta.url,
  )
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "usb-symbol-primitive-layering.kicad_sch",
    readFileSync(schematicPath, "utf-8"),
  )
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  const usbSourceComponent = circuitJson.find(
    (element) =>
      element.type === "source_component" &&
      element.name ===
        "OtterCastAudioV2-rescue:USB_C_Receptacle_USB2.0-Connector",
  )

  expect(usbSourceComponent).toBeDefined()
  if (usbSourceComponent?.type !== "source_component") {
    throw new Error("Expected the USB connector source component")
  }

  const usbSchematicComponent = circuitJson.find(
    (element) =>
      element.type === "schematic_component" &&
      element.source_component_id === usbSourceComponent.source_component_id,
  )

  expect(usbSchematicComponent).toBeDefined()
  if (usbSchematicComponent?.type !== "schematic_component") {
    throw new Error("Expected the USB connector schematic component")
  }

  const usbArcs = circuitJson.filter(
    (element) =>
      element.type === "schematic_arc" &&
      element.schematic_component_id ===
        usbSchematicComponent.schematic_component_id,
  )
  expect(usbArcs).toHaveLength(6)

  const fs = await import("node:fs/promises")
  const snapshotDirectory = new URL("./__snapshots__/", import.meta.url)
  await fs.mkdir(snapshotDirectory, { recursive: true })
  await fs.writeFile(
    new URL(
      "usb-symbol-primitive-layering-circuit-json.json",
      snapshotDirectory,
    ),
    JSON.stringify(circuitJson, null, 2),
  )

  const kicadSnapshot = await takeKicadSnapshot({
    kicadFilePath: fileURLToPath(schematicPath),
    kicadFileType: "sch",
    generatePng: false,
  })
  const kicadSvg = Object.values(kicadSnapshot.generatedFileContent)[0]
  if (!kicadSvg) throw new Error("Expected a KiCad schematic snapshot")

  const { convertCircuitJsonToSchematicSvg } = await import("circuit-to-svg")
  const circuitJsonSvg = convertCircuitJsonToSchematicSvg(circuitJson, {
    width: 700,
    height: 800,
  })
    .replaceAll("sans-serif", "Arial, sans-serif")
    .replace(/[ \t]+$/gm, "")
  await fs.writeFile(
    new URL(
      "usb-symbol-primitive-layering-circuit-json.svg",
      snapshotDirectory,
    ),
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
    "usb-symbol-primitive-layering",
  )
}, 30_000)
