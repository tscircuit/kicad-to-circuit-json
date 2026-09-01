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

  const schematicComponentsById = new Map(
    circuitJson
      .filter((element) => element.type === "schematic_component")
      .map((component) => [component.schematic_component_id, component]),
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

  expect(wireTraces).toHaveLength(13)
  expect(schematicTraces).toHaveLength(13)
  expect(
    schematicTraces.reduce(
      (junctionCount, trace) => junctionCount + trace.junctions.length,
      0,
    ),
  ).toBe(1)
  expect(sourcePorts).toHaveLength(23)
  expect(componentPrimitives.length).toBeGreaterThan(20)
  const schematicTextValues = circuitJson.flatMap((element) =>
    element.type === "schematic_text" ? [element.text] : [],
  )
  expect(schematicTextValues).toContain("VBUS")
  expect(schematicTextValues).toContain("A9")
  expect(schematicTextValues).toContain("USB-C 2.0")
  expect(schematicTextValues).toContain("LED")
  expect(
    circuitJson.filter((element) => element.type === "schematic_rect"),
  ).toHaveLength(2)
  expect(
    schematicTextValues.some(
      (text) => text.startsWith("#PWR") || text.startsWith("#FLG"),
    ),
  ).toBe(false)

  const usbSourceComponent = circuitJson
    .filter((element) => element.type === "source_component")
    .find(
      (element) => element.name === "Connector:USB_C_Receptacle_PowerOnly_6P",
    )
  const usbSchematicComponent = [...schematicComponentsById.values()].find(
    (component) =>
      component.source_component_id === usbSourceComponent?.source_component_id,
  )
  const vbusSourcePort = sourcePorts.find(
    (element) =>
      element.source_component_id === usbSourceComponent?.source_component_id &&
      element.port_hints?.includes("A9"),
  )
  const vbusSchematicPort = schematicPorts.find(
    (port) => port.source_port_id === vbusSourcePort?.source_port_id,
  )
  expect(vbusSchematicPort?.center.y).toBeGreaterThan(
    usbSchematicComponent?.center.y ?? Number.POSITIVE_INFINITY,
  )
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
