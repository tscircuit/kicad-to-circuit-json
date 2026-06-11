import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { convertCircuitJsonToSchematicSvg } from "circuit-to-svg"
import { KicadToCircuitJsonConverter } from "../../lib"
import { takeCircuitJsonSnapshot } from "../fixtures/take-circuit-json-snapshot"
import { takeKicadSymbolLibrarySnapshot } from "../fixtures/take-kicad-symbol-library-snapshot"
import { stackCircuitJsonKicadPngs } from "../fixtures/stackCircuitJsonKicadPngs"
import "../fixtures/png-matcher"

function convertCm5IoSymbolLibrary() {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "CM5IO.kicad_sym",
    readFileSync("tests/assets/CM5IO.kicad_sym", "utf-8"),
  )
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  const sourceComponents = circuitJson.filter(
    (element) => element.type === "source_component",
  )
  const sourcePorts = circuitJson.filter(
    (element) => element.type === "source_port",
  )
  const schematicPorts = circuitJson.filter(
    (element) => element.type === "schematic_port",
  )
  const schematicComponents = circuitJson.filter(
    (element) => element.type === "schematic_component",
  )

  return {
    converter,
    circuitJson,
    sourceComponents,
    sourcePorts,
    schematicPorts,
    schematicComponents,
  }
}

test("kicad-to-circuit-json: CM5IO symbol library uses symbol-library stages", () => {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "CM5IO.kicad_sym",
    readFileSync("tests/assets/CM5IO.kicad_sym", "utf-8"),
  )
  converter.initializePipeline()

  expect(converter.pipeline?.map((stage) => stage.constructor.name)).toEqual([
    "InitializeSymbolLibraryContextStage",
    "CollectSymbolLibrarySymbolsStage",
  ])
})

test("kicad-to-circuit-json: CM5IO symbol library emits source components and ports", async () => {
  const {
    converter,
    circuitJson,
    sourceComponents,
    sourcePorts,
    schematicPorts,
    schematicComponents,
  } = convertCm5IoSymbolLibrary()

  expect(circuitJson.length).toBeGreaterThan(0)
  expect(sourceComponents.length).toBe(36)
  expect(sourcePorts.length).toBe(487)
  expect(schematicPorts.length).toBe(487)
  expect(schematicComponents.length).toBe(36)
  expect(
    schematicComponents.every(
      (schematicComponent) =>
        schematicComponent.is_box_with_pins === true &&
        schematicComponent.size.width === 0 &&
        schematicComponent.size.height === 0,
    ),
  ).toBe(true)
  expect(converter.getStats()).toEqual({
    components: 36,
    pads: 487,
  })

  const getComponent = (name: string) =>
    sourceComponents.find((component) => component.name === name)

  const getPorts = (componentName: string) => {
    const component = getComponent(componentName)
    expect(component).toBeDefined()
    return sourcePorts.filter(
      (port) => port.source_component_id === component.source_component_id,
    )
  }

  expect(getComponent("R")?.ftype).toBe("simple_resistor")
  expect(getPorts("R").map((port) => port.pin_number)).toEqual([1, 2])
  const resistorComponent = getComponent("R")
  const resistorSchematicComponent = schematicComponents.find(
    (component) =>
      component.source_component_id === resistorComponent?.source_component_id,
  )
  const resistorPorts = getPorts("R")
  const resistorSchematicPorts = schematicPorts.filter(
    (port) =>
      port.schematic_component_id ===
      resistorSchematicComponent?.schematic_component_id,
  )
  expect(resistorSchematicPorts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source_port_id: resistorPorts[0]?.source_port_id,
        pin_number: 1,
        side_of_component: "top",
        distance_from_component_edge: expect.any(Number),
      }),
      expect.objectContaining({
        source_port_id: resistorPorts[1]?.source_port_id,
        pin_number: 2,
        side_of_component: "bottom",
        distance_from_component_edge: expect.any(Number),
      }),
    ]),
  )
  expect(
    circuitJson.filter(
      (element) =>
        element.type === "schematic_line" &&
        element.schematic_component_id ===
          resistorSchematicComponent?.schematic_component_id &&
        Math.hypot(element.x2 - element.x1, element.y2 - element.y1) > 0,
    ).length,
  ).toBe(0)
  expect(getComponent("C")?.ftype).toBe("simple_capacitor")
  expect(getPorts("C").map((port) => port.pin_number)).toEqual([1, 2])

  const usbCComponent = getComponent("USB_C_Receptacle_USB2.0_16P")
  const usbCSchematicComponent = schematicComponents.find(
    (component) =>
      component.source_component_id === usbCComponent?.source_component_id,
  )
  const usbCElements = circuitJson.filter(
    (element) =>
      element.schematic_component_id ===
      usbCSchematicComponent?.schematic_component_id,
  )
  expect(
    usbCElements.some(
      (element) =>
        element.type === "schematic_rect" &&
        element.is_filled &&
        element.fill_color === "rgb(255, 255, 194)",
    ),
  ).toBe(true)
  expect(
    usbCElements.some(
      (element) =>
        (element.type === "schematic_path" ||
          element.type === "schematic_circle" ||
          element.type === "schematic_rect") &&
        element.is_filled &&
        element.fill_color === "rgb(132, 0, 0)",
    ),
  ).toBe(true)

  const gpioPorts = getPorts("ComputeModule5-CM5_GPIO")
  expect(gpioPorts.length).toBe(100)
  expect(
    gpioPorts.find(
      (port) => port.pin_number === 4 && port.name === "Ethernet_Pair1_P",
    ),
  ).toBeDefined()
  expect(
    gpioPorts.find(
      (port) => port.pin_number === 99 && port.name === "PMIC_ENABLE",
    ),
  ).toBeDefined()

  const hssPorts = getPorts("ComputeModule5-CM5_HSS")
  expect(hssPorts.length).toBe(100)
  expect(
    hssPorts.find(
      (port) => port.pin_number === 110 && port.name === "PCIe_CLK_P",
    ),
  ).toBeDefined()

  const typeCPorts = getPorts("TYPEC-305-ACP16H458")
  expect(typeCPorts.length).toBe(17)
  expect(
    typeCPorts.find(
      (port) => port.port_hints?.includes("A5") && port.name === "CC1",
    ),
  ).toBeDefined()
  expect(
    typeCPorts.find((port) => port.pin_number === 1 && port.name === "EP"),
  ).toBeDefined()

  const getElementCount = (type: string) =>
    circuitJson.filter((element) => element.type === type).length

  expect(getElementCount("schematic_line")).toBeGreaterThan(0)
  expect(getElementCount("schematic_rect")).toBeGreaterThan(0)
  expect(getElementCount("schematic_circle")).toBeGreaterThan(0)
  expect(getElementCount("schematic_arc")).toBeGreaterThan(0)
  expect(getElementCount("schematic_path")).toBeGreaterThan(0)
  expect(getElementCount("schematic_text")).toBeGreaterThan(0)
  expect(
    schematicComponents.every(
      (component) => typeof component.symbol_display_value === "string",
    ),
  ).toBe(true)
  expect(
    circuitJson.some(
      (element) =>
        element.type === "schematic_text" &&
        element.text === "TYPEC-305-ACP16H458",
    ),
  ).toBe(true)

  const schematicSvg = await convertCircuitJsonToSchematicSvg(circuitJson, {
    width: 1200,
    height: 1140,
  })
  expect(schematicSvg.match(/class="component-pin"/g)?.length).toBe(
    sourcePorts.length * 2,
  )
  expect(schematicSvg).toContain("Ethernet_Pair1_P")
  expect(schematicSvg).toContain("CC1")
})

test("kicad-to-circuit-json: CM5IO symbol library schematic snapshot", async () => {
  const { circuitJson } = convertCm5IoSymbolLibrary()

  const fs = await import("node:fs/promises")
  await fs.mkdir("tests/symbol-library/__snapshots__", {
    recursive: true,
  })
  await fs.writeFile(
    "tests/symbol-library/__snapshots__/cm5io-symbol-library-circuit-json.json",
    JSON.stringify(circuitJson, null, 2),
  )

  const circuitJsonSvg = await convertCircuitJsonToSchematicSvg(circuitJson, {
    width: 1200,
    height: 1140,
  })
  await fs.writeFile(
    "tests/symbol-library/__snapshots__/cm5io-symbol-library-circuit-json.svg",
    circuitJsonSvg,
  )
  const circuitJsonPng = await takeCircuitJsonSnapshot({
    circuitJson,
    outputType: "schematic",
    width: 1200,
    height: 1140,
  })

  const kicadSymbolLibrarySnapshot = await takeKicadSymbolLibrarySnapshot({
    kicadFilePath: "tests/assets/CM5IO.kicad_sym",
  })
  expect(kicadSymbolLibrarySnapshot.symbolCount).toBe(36)
  expect(
    circuitJson
      .filter((element) => element.type === "source_component")
      .map((element) => element.name),
  ).toEqual(
    kicadSymbolLibrarySnapshot.svgFileNames.map((fileName) =>
      fileName.replace(/_unit\d+\.svg$/, ""),
    ),
  )

  const stackedPng = await stackCircuitJsonKicadPngs(
    circuitJsonPng,
    kicadSymbolLibrarySnapshot.png,
  )

  await expect(stackedPng).toMatchPngSnapshot(
    import.meta.path,
    "cm5io-symbol-library-schematic",
  )
})
