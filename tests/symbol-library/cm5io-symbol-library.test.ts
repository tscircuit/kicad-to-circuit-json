import { $ } from "bun"
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
import { KicadToCircuitJsonConverter } from "../../lib"
import { takeCircuitJsonSnapshot } from "../fixtures/take-circuit-json-snapshot"
import { stackCircuitJsonKicadPngs } from "../fixtures/stackCircuitJsonKicadPngs"
import "../fixtures/png-matcher"

function convertCm5IoSymbolLibrary() {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "CM5IO.kicad_sym",
    readFileSync("tests/assets/CM5IO.kicad_sym", "utf-8"),
  )
  converter.runUntilFinished()

  const circuitJson = converter.getOutput() as any[]
  const sourceComponents = circuitJson.filter(
    (element) => element.type === "source_component",
  )
  const sourcePorts = circuitJson.filter(
    (element) => element.type === "source_port",
  )

  return {
    converter,
    circuitJson,
    sourceComponents,
    sourcePorts,
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
  const { converter, circuitJson, sourceComponents, sourcePorts } =
    convertCm5IoSymbolLibrary()

  expect(circuitJson.length).toBeGreaterThan(0)
  expect(sourceComponents.length).toBe(36)
  expect(sourcePorts.length).toBe(487)
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
    typeCPorts.find((port) => port.pin_number === "A5" && port.name === "CC1"),
  ).toBeDefined()
  expect(
    typeCPorts.find((port) => port.pin_number === 1 && port.name === "EP"),
  ).toBeDefined()
})

test("kicad-to-circuit-json: CM5IO symbol library schematic snapshot", async () => {
  const { circuitJson } = convertCm5IoSymbolLibrary()

  const circuitJsonPng = await takeCircuitJsonSnapshot({
    circuitJson: circuitJson as any,
    outputType: "schematic",
  })

  const kicadSymbolLibraryPng = await takeKicadSymbolLibrarySnapshot(
    "tests/assets/CM5IO.kicad_sym",
  )

  const stackedPng = await stackCircuitJsonKicadPngs(
    circuitJsonPng,
    kicadSymbolLibraryPng,
  )

  await expect(stackedPng).toMatchPngSnapshot(
    import.meta.path,
    "cm5io-symbol-library-schematic",
  )
})

async function takeKicadSymbolLibrarySnapshot(kicadSymbolLibPath: string) {
  const kicadCliVersion = await $`kicad-cli --version`
  expect(kicadCliVersion.stdout.toString().trim().startsWith("10.")).toBe(true)

  const tempDir = await mkdtemp(join(tmpdir(), "kicad-symbol-snapshot-"))

  try {
    await $`kicad-cli sym export svg ${kicadSymbolLibPath} -o ${tempDir} --theme Modern`

    const svgFileNames = (await readdir(tempDir))
      .filter((fileName) => fileName.endsWith(".svg"))
      .sort()

    expect(svgFileNames.length).toBe(36)

    const symbolPngs = await Promise.all(
      svgFileNames.map(async (fileName) => {
        const svgBuffer = await readFile(join(tempDir, fileName))
        return sharp(svgBuffer, { density: 100 }).png().toBuffer()
      }),
    )

    return createSymbolContactSheet(symbolPngs)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function createSymbolContactSheet(symbolPngs: Buffer[]) {
  const columns = 6
  const tileWidth = 200
  const tileHeight = 190
  const rows = Math.ceil(symbolPngs.length / columns)
  const width = columns * tileWidth
  const height = rows * tileHeight

  const composites = await Promise.all(
    symbolPngs.map(async (png, index) => {
      const resized = await sharp(png)
        .resize(tileWidth - 24, tileHeight - 24, {
          fit: "contain",
          background: { r: 245, g: 241, b: 237, alpha: 0 },
        })
        .png()
        .toBuffer()
      const metadata = await sharp(resized).metadata()

      return {
        input: resized,
        left:
          (index % columns) * tileWidth +
          Math.floor((tileWidth - (metadata.width ?? tileWidth)) / 2),
        top:
          Math.floor(index / columns) * tileHeight +
          Math.floor((tileHeight - (metadata.height ?? tileHeight)) / 2),
      }
    }),
  )

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 245, g: 241, b: 237, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer()
}
