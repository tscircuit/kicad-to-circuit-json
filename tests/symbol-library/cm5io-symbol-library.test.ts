import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
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
  const schematicComponents = circuitJson.filter(
    (element) => element.type === "schematic_component",
  )

  return {
    converter,
    circuitJson,
    sourceComponents,
    sourcePorts,
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

test("kicad-to-circuit-json: CM5IO symbol library emits source components and ports", () => {
  const {
    converter,
    circuitJson,
    sourceComponents,
    sourcePorts,
    schematicComponents,
  } = convertCm5IoSymbolLibrary()

  expect(circuitJson.length).toBeGreaterThan(0)
  expect(sourceComponents.length).toBe(36)
  expect(sourcePorts.length).toBe(487)
  expect(schematicComponents.length).toBe(36)
  expect(
    schematicComponents.every(
      (schematicComponent) => schematicComponent.is_box_with_pins === false,
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
  expect(getComponent("C")?.ftype).toBe("simple_capacitor")
  expect(getPorts("C").map((port) => port.pin_number)).toEqual([1, 2])

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
})

test("kicad-to-circuit-json: CM5IO symbol library schematic snapshot", async () => {
  const { circuitJson } = convertCm5IoSymbolLibrary()

  const circuitJsonPng = await takeCircuitJsonSnapshot({
    circuitJson,
    outputType: "schematic",
  })

  const kicadSymbolLibrarySnapshot = await takeKicadSymbolLibrarySnapshot({
    kicadFilePath: "tests/assets/CM5IO.kicad_sym",
  })
  expect(kicadSymbolLibrarySnapshot.symbolCount).toBe(36)

  const stackedPng = await stackCircuitJsonKicadPngs(
    circuitJsonPng,
    kicadSymbolLibrarySnapshot.png,
  )

  await expect(stackedPng).toMatchPngSnapshot(
    import.meta.path,
    "cm5io-symbol-library-schematic",
  )
})
