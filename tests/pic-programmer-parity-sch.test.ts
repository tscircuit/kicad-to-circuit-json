import { expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../lib"
import { stackCircuitJsonKicadPngs } from "./fixtures/stackCircuitJsonKicadPngs"
import { takeCircuitJsonSnapshot } from "./fixtures/take-circuit-json-snapshot"
import { takeKicadSnapshot } from "./fixtures/take-kicad-snapshot"
import "./fixtures/png-matcher"

test("kicad-to-circuit-json: pic_programmer schematic", async () => {
  // Load the KiCad schematic file
  const kicadSchPath =
    "kicad-demos/demos/pic_programmer/pic_programmer.kicad_sch"

  if (!existsSync(kicadSchPath)) {
    console.warn(
      `Skipping pic_programmer schematic test, fixture missing: ${kicadSchPath}`,
    )
    return
  }

  const kicadSchContent = readFileSync(kicadSchPath, "utf-8")

  // Convert to Circuit JSON
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("pic_programmer.kicad_sch", kicadSchContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()

  // Verify we got some output
  expect(circuitJson).toBeDefined()
  expect(circuitJson.length).toBeGreaterThan(0)

  const schematicComponents = circuitJson.filter(
    (element) => element.type === "schematic_component",
  )
  const schematicComponentsById = new Map(
    schematicComponents.map((component) => [
      component.schematic_component_id,
      component,
    ]),
  )
  const schematicPorts = circuitJson.filter(
    (element) => element.type === "schematic_port",
  )
  const wireTraces = circuitJson.filter(
    (element) => element.type === "schematic_trace" && element.edges.length > 0,
  )

  expect(schematicPorts).toHaveLength(182)
  expect(wireTraces).toHaveLength(131)
  expect(
    schematicPorts.every((port) => {
      if (!port.schematic_component_id) return false
      const component = schematicComponentsById.get(port.schematic_component_id)
      if (!component) return false

      return (
        Math.hypot(
          port.center.x - component.center.x,
          port.center.y - component.center.y,
        ) < 2
      )
    }),
  ).toBe(true)

  // Write Circuit JSON to file for inspection
  const fs = await import("node:fs/promises")
  await fs.writeFile(
    "tests/__snapshots__/pic_programmer-schematic-circuit-json.json",
    JSON.stringify(circuitJson, null, 2),
  )

  // Take snapshots
  const kicadSnapshot = await takeKicadSnapshot({
    kicadFilePath: kicadSchPath,
    kicadFileType: "sch",
  })

  const kicadPng = kicadSnapshot.generatedFileContent["pic_programmer.png"]!

  const circuitJsonPng = await takeCircuitJsonSnapshot({
    circuitJson: circuitJson as any,
    outputType: "schematic",
  })

  // Also export the circuit JSON as SVG for inspection
  const { convertCircuitJsonToSchematicSvg } = await import("circuit-to-svg")
  const circuitJsonSvg = convertCircuitJsonToSchematicSvg(circuitJson as any)

  await fs.writeFile(
    "tests/__snapshots__/pic_programmer-schematic-circuit-json.svg",
    circuitJsonSvg,
  )

  // Compare the native KiCad source on the left with Circuit JSON on the right
  const stackedPng = await stackCircuitJsonKicadPngs(
    circuitJsonPng,
    kicadPng,
    "horizontal",
  )

  // Save as snapshot for visual comparison
  await expect(stackedPng).toMatchPngSnapshot(
    import.meta.path,
    "pic_programmer-schematic",
  )
}, 10_000)
