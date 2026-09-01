import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { CircuitJsonToKicadSchConverter } from "circuit-json-to-kicad"
import { parseKicadSch } from "kicadts"
import { KicadToCircuitJsonConverter } from "../lib"
import { stackPngsHorizontally } from "./fixtures/stackPngsHorizontally"
import { takeKicadSnapshot } from "./fixtures/take-kicad-snapshot"
import "./fixtures/png-matcher"

test("round-trips a real schematic with valid source-component links", async () => {
  const schematicPath = "references/hsp-usb-led.kicad_sch"
  const schematicContent = readFileSync(schematicPath, "utf8")
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("hsp-usb-led.kicad_sch", schematicContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  const sourceComponents = circuitJson.filter(
    (element) => element.type === "source_component",
  )
  const schematicComponents = circuitJson.filter(
    (element) => element.type === "schematic_component",
  )
  const sourceComponentIds = new Set(
    sourceComponents.map((component) => component.source_component_id),
  )

  expect(sourceComponents).toHaveLength(12)
  expect(schematicComponents).toHaveLength(12)
  expect(
    schematicComponents.every((component) =>
      component.source_component_id
        ? sourceComponentIds.has(component.source_component_id)
        : false,
    ),
  ).toBe(true)

  expect(
    new Set(
      schematicComponents.map((component) => component.source_component_id),
    ).size,
  ).toBe(sourceComponents.length)

  const roundTripConverter = new CircuitJsonToKicadSchConverter(circuitJson)
  roundTripConverter.runUntilFinished()
  const roundTripSchematic = roundTripConverter.getOutputString()

  expect(parseKicadSch(roundTripSchematic).symbols).toHaveLength(12)

  const [sourceSnapshot, roundTripSnapshot] = await Promise.all([
    takeKicadSnapshot({
      kicadFilePath: schematicPath,
      kicadFileType: "sch",
    }),
    takeKicadSnapshot({
      kicadFileContent: roundTripSchematic,
      kicadFileType: "sch",
    }),
  ])
  const comparisonPng = await stackPngsHorizontally([
    sourceSnapshot.generatedFileContent["hsp-usb-led.png"]!,
    roundTripSnapshot.generatedFileContent["temp_file.png"]!,
  ])

  await expect(comparisonPng).toMatchPngSnapshot(import.meta.path)
}, 20_000)
