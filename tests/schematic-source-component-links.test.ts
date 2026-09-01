import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../lib"
import { stackCircuitJsonKicadPngs } from "./fixtures/stackCircuitJsonKicadPngs"
import { takeCircuitJsonSnapshot } from "./fixtures/take-circuit-json-snapshot"
import { takeKicadSnapshot } from "./fixtures/take-kicad-snapshot"
import "./fixtures/png-matcher"

test("schematic components reference their inserted source components", async () => {
  const schematicPath = "tests/assets/hsp-usb-led.kicad_sch"
  const schematicContent = readFileSync(schematicPath, "utf8")
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("hsp-usb-led.kicad_sch", schematicContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  const sourceComponent = circuitJson.find(
    (element) => element.type === "source_component",
  )
  const schematicComponent = circuitJson.find(
    (element) => element.type === "schematic_component",
  )

  expect(sourceComponent).toBeDefined()
  expect(schematicComponent).toBeDefined()
  expect(schematicComponent?.source_component_id).toBe(
    sourceComponent?.source_component_id,
  )

  const [kicadSnapshot, circuitJsonPng] = await Promise.all([
    takeKicadSnapshot({
      kicadFilePath: schematicPath,
      kicadFileType: "sch",
    }),
    takeCircuitJsonSnapshot({
      circuitJson: circuitJson as any,
      outputType: "schematic",
    }),
  ])
  const kicadPng = kicadSnapshot.generatedFileContent["hsp-usb-led.png"]!
  const comparisonPng = await stackCircuitJsonKicadPngs(
    circuitJsonPng,
    kicadPng,
    "horizontal",
  )

  await expect(comparisonPng).toMatchPngSnapshot(import.meta.path)
}, 10_000)
