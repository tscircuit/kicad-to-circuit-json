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
  const sourcePorts = circuitJson.filter(
    (element) => element.type === "source_port",
  )
  const wireTraces = circuitJson.filter(
    (element) => element.type === "schematic_trace" && element.edges.length > 0,
  )
  const schematicTraces = circuitJson.filter(
    (element) => element.type === "schematic_trace",
  )
  const componentPrimitives = circuitJson.filter(
    (element) =>
      "schematic_component_id" in element &&
      element.schematic_component_id !== undefined &&
      [
        "schematic_line",
        "schematic_path",
        "schematic_rect",
        "schematic_circle",
        "schematic_arc",
      ].includes(element.type),
  )
  const schematicTexts = circuitJson.filter(
    (element) => element.type === "schematic_text",
  )

  expect(schematicPorts).toHaveLength(182)
  expect(sourcePorts).toHaveLength(182)
  expect(wireTraces).toHaveLength(131)
  expect(schematicTraces).toHaveLength(131)
  expect(
    schematicTraces.reduce(
      (junctionCount, trace) => junctionCount + trace.junctions.length,
      0,
    ),
  ).toBe(26)
  expect(componentPrimitives.length).toBeGreaterThan(100)
  expect(
    circuitJson.some(
      (element) =>
        element.type === "schematic_text" && element.text.startsWith("#PWR"),
    ),
  ).toBe(false)
  expect(
    schematicComponents.every(
      (component) => component.is_box_with_pins === false,
    ),
  ).toBe(true)
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

  expect(
    circuitJson.filter((element) => element.type === "schematic_net_label"),
  ).toHaveLength(0)
  const sourceNets = circuitJson.filter(
    (element) => element.type === "source_net",
  )
  expect(sourceNets).toHaveLength(7)
  expect(new Set(sourceNets.map((sourceNet) => sourceNet.name))).toEqual(
    new Set([
      "DATA-RB7",
      "CLOCK-RB6",
      "PC-DATA-IN",
      "PC-DATA-OUT",
      "VPP/MCLR",
      "VPP_ON",
      "PC-CLOCK-OUT",
    ]),
  )
  const localLabelTexts = schematicTexts.filter(
    (element) =>
      element.schematic_component_id === undefined &&
      element.color === "rgb(15, 15, 15)",
  )
  expect(localLabelTexts).toHaveLength(10)
  expect(localLabelTexts.every((label) => label.rotation === 0)).toBe(true)
  expect(new Set(localLabelTexts.map((label) => label.text))).toEqual(
    new Set(sourceNets.map((sourceNet) => sourceNet.name)),
  )
  expect(
    circuitJson.filter(
      (element) =>
        element.type === "schematic_text" &&
        element.schematic_component_id === undefined,
    ).length,
  ).toBeGreaterThanOrEqual(8)
  const schematicTextValues = circuitJson.flatMap((element) =>
    element.type === "schematic_text" ? [element.text] : [],
  )
  expect(schematicTextValues).toContain("ADJUST for VPP = 13V")
  expect(schematicTextValues).toContain("pic_sockets")
  expect(schematicTextValues).toContain("VPP-MCLR")
  const sheetPinNames = new Set([
    "VPP-MCLR",
    "CLOCK-RB6",
    "DATA-RB7",
    "VCC_PIC",
  ])
  const sheetPinTexts = schematicTexts.filter(
    (element) =>
      element.schematic_component_id === undefined &&
      element.color === "rgb(0, 100, 100)" &&
      sheetPinNames.has(element.text),
  )
  expect(sheetPinTexts).toHaveLength(4)
  expect(sheetPinTexts.every((pin) => pin.rotation === 0)).toBe(true)
  expect(sheetPinTexts.every((pin) => pin.anchor === "center_left")).toBe(true)
  expect(
    schematicTexts.some(
      (text) =>
        text.text === "pic_sockets" && text.color === "rgb(0, 100, 100)",
    ),
  ).toBe(true)
  expect(
    schematicTexts.some(
      (text) =>
        text.text === "pic_sockets.kicad_sch" &&
        text.color === "rgb(132, 0, 0)",
    ),
  ).toBe(true)
  expect(
    circuitJson.filter((element) => element.type === "schematic_box"),
  ).toHaveLength(1)
  expect(
    circuitJson.filter(
      (element) =>
        element.type === "schematic_line" &&
        element.schematic_component_id === undefined,
    ),
  ).toHaveLength(12)
  expect(
    circuitJson.filter(
      (element) =>
        element.type === "schematic_path" &&
        element.schematic_component_id === undefined,
    ),
  ).toHaveLength(12)
  expect(
    circuitJson.filter(
      (element) =>
        element.type === "schematic_path" &&
        element.schematic_component_id === undefined &&
        element.stroke_color === "rgb(0, 100, 100)",
    ),
  ).toHaveLength(4)

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
