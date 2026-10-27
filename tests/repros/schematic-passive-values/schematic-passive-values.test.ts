import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { source_simple_capacitor, source_simple_resistor } from "circuit-json"
import {
  convertCircuitJsonToPcbSvg,
  convertCircuitJsonToSchematicSvg,
} from "circuit-to-svg"
import { parseKicadSch } from "kicadts"
import sharp from "sharp"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { stackCircuitJsonKicadPngs } from "../../fixtures/stackCircuitJsonKicadPngs"
import { takeCircuitJsonSnapshot } from "../../fixtures/take-circuit-json-snapshot"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"
import "../../fixtures/png-matcher"

const schematicContent = readFileSync(
  new URL("./passive-values.kicad_sch", import.meta.url),
  "utf8",
)
const schematic = parseKicadSch(schematicContent)
const converter = new KicadToCircuitJsonConverter()
converter.addFile("passive-values.kicad_sch", schematicContent)
converter.runUntilFinished()
const circuitJson = converter.getOutput()
const sourceComponents = circuitJson.filter(
  (element) => element.type === "source_component",
)
const resistor = sourceComponents.find(
  (component) => component.ftype === "simple_resistor",
)
const capacitor = sourceComponents.find(
  (component) => component.ftype === "simple_capacitor",
)

test("repro: placed passive values are parsed but their required source properties are missing", () => {
  expect(
    schematic.symbols.map((symbol) => ({
      reference: symbol.properties.find(
        (property) => property.key === "Reference",
      )?.value,
      value: symbol.properties.find((property) => property.key === "Value")
        ?.value,
    })),
  ).toEqual([
    { reference: "R1", value: "10k" },
    { reference: "C1", value: "100n" },
  ])
  expect(sourceComponents).toHaveLength(2)
  expect(resistor).toBeDefined()
  expect(capacitor).toBeDefined()
  expect(
    circuitJson.filter((element) => element.type === "schematic_port"),
  ).toHaveLength(4)
  expect(converter.getWarnings()).toEqual([])

  const resistorValidation = source_simple_resistor.safeParse(resistor)
  const capacitorValidation = source_simple_capacitor.safeParse(capacitor)

  // Supplying just the missing values makes each source component valid.
  expect(
    source_simple_resistor.safeParse({ ...resistor, resistance: 10_000 })
      .success,
  ).toBe(true)
  expect(
    source_simple_capacitor.safeParse({ ...capacitor, capacitance: 100e-9 })
      .success,
  ).toBe(true)

  // Capture the current bug, including the field paths rejected by the actual
  // circuit-json schemas. The follow-up fix should update this snapshot.
  expect({
    resistor: {
      source_component: resistor,
      validation: resistorValidation.success
        ? { success: true }
        : {
            success: false,
            issues: resistorValidation.error.issues.map(({ code, path }) => ({
              code,
              path,
            })),
          },
    },
    capacitor: {
      source_component: capacitor,
      validation: capacitorValidation.success
        ? { success: true }
        : {
            success: false,
            issues: capacitorValidation.error.issues.map(({ code, path }) => ({
              code,
              path,
            })),
          },
    },
  }).toMatchSnapshot()
})

test("repro: schematic snapshot compares KiCad with the imported circuit and schema status", async () => {
  const snapshotsDir = new URL("./__snapshots__/", import.meta.url)
  await mkdir(snapshotsDir, { recursive: true })
  await writeFile(
    new URL("passive-values-schematic-circuit-json.json", snapshotsDir),
    JSON.stringify(circuitJson, null, 2),
  )
  const circuitJsonSvg = convertCircuitJsonToSchematicSvg(circuitJson, {
    width: 1200,
    height: 500,
    includeVersion: false,
  })
    .replaceAll("sans-serif", "Arial, sans-serif")
    .replace(/[ \t]+$/gm, "")
  await writeFile(
    new URL("passive-values-schematic-circuit-json.svg", snapshotsDir),
    circuitJsonSvg,
  )

  const kicadSnapshot = await takeKicadSnapshot({
    kicadFileContent: schematicContent,
    kicadFileType: "sch",
    generatePng: false,
    excludeDrawingSheet: true,
  })
  const kicadSvg = Object.values(kicadSnapshot.generatedFileContent)[0]
  if (!kicadSvg) throw new Error("Expected a KiCad schematic snapshot")
  // Crop blank A4 paper in SVG coordinates before rasterization, retaining
  // both fixture symbols, their pins, and their Reference/Value labels.
  const croppedKicadSvg = kicadSvg
    .toString()
    .replace(
      /width="[^"]+" height="[^"]+" viewBox="[^"]+"/,
      'width="1200" height="500" viewBox="46 44 41 14"',
    )

  // Use the same trim-and-fit workflow as the schematic graphics repros.
  const renderPreview = async (svg: Buffer) => {
    const rendered = await sharp(svg, { density: 192 })
      .flatten({ background: "#F5F4EF" })
      .png()
      .toBuffer()
    const trimmed = await sharp(rendered)
      .trim({ background: "#F5F4EF", threshold: 10 })
      .png()
      .toBuffer()
    const padded = await sharp(trimmed)
      .extend({
        top: 30,
        bottom: 30,
        left: 30,
        right: 30,
        background: "#F5F4EF",
      })
      .png()
      .toBuffer()
    return sharp(padded)
      .resize({
        width: 1200,
        height: 500,
        fit: "contain",
        background: "#F5F4EF",
      })
      .png()
      .toBuffer()
  }
  const [circuitJsonPng, kicadPng] = await Promise.all([
    renderPreview(Buffer.from(circuitJsonSvg)),
    renderPreview(Buffer.from(croppedKicadSvg)),
  ])
  const stackedPng = await stackCircuitJsonKicadPngs(circuitJsonPng, kicadPng)

  // Visible Value text survives this bug. Show the actual source-field and
  // schema checks separately, without altering either schematic rendering.
  const schemaEvidence =
    Buffer.from(`<svg width="1200" height="180" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="180" fill="#ffffff"/>
    <g font-family="Arial, sans-serif" fill="#1f2937">
      <text x="24" y="34" font-size="24" font-weight="bold">Source-component schema checks (separate from drawing)</text>
      <text x="24" y="75" font-size="22">R1 / 10k: resistance ${resistor && "resistance" in resistor ? "present" : "MISSING"}; expected 10000 ohms; schema ${source_simple_resistor.safeParse(resistor).success ? "PASS" : "FAIL"}</text>
      <text x="24" y="113" font-size="22">C1 / 100n: capacitance ${capacitor && "capacitance" in capacitor ? "present" : "MISSING"}; expected 1e-7 farads; schema ${source_simple_capacitor.safeParse(capacitor).success ? "PASS" : "FAIL"}</text>
      <text x="24" y="154" font-size="20">Value labels can look correct while the required electrical properties are absent.</text>
    </g>
  </svg>`)
  const snapshot = await sharp(stackedPng)
    .extend({ bottom: 180, background: "#ffffff" })
    .composite([{ input: schemaEvidence, left: 0, top: 1000 }])
    .png()
    .toBuffer()
  await expect(snapshot).toMatchPngSnapshot(
    import.meta.path,
    "passive-values-schematic",
  )
}, 30_000)

test("repro: companion PCB preserves passive values and matches the PCB snapshot", async () => {
  // The PCB path is a positive control. Keep it separate from the schematic
  // import so its valid source components cannot mask the missing properties.
  const pcbContent = readFileSync(
    new URL("./passive-values.kicad_pcb", import.meta.url),
    "utf8",
  )
  const pcbConverter = new KicadToCircuitJsonConverter()
  pcbConverter.addFile("passive-values.kicad_pcb", pcbContent)
  pcbConverter.runUntilFinished()
  const pcbCircuitJson = pcbConverter.getOutput()
  const pcbSourceComponents = pcbCircuitJson.filter(
    (element) => element.type === "source_component",
  )
  expect(pcbSourceComponents).toHaveLength(2)
  expect(
    source_simple_resistor.parse(
      pcbSourceComponents.find((component) => component.name === "R1"),
    ).resistance,
  ).toBe(10_000)
  expect(
    source_simple_capacitor.parse(
      pcbSourceComponents.find((component) => component.name === "C1"),
    ).capacitance,
  ).toBeCloseTo(100e-9, 12)
  expect(
    pcbCircuitJson.filter((element) => element.type === "pcb_smtpad"),
  ).toHaveLength(4)
  expect(pcbConverter.getWarnings()).toEqual([])

  const snapshotsDir = new URL("./__snapshots__/", import.meta.url)
  await mkdir(snapshotsDir, { recursive: true })
  await writeFile(
    new URL("passive-values-pcb-circuit-json.json", snapshotsDir),
    JSON.stringify(pcbCircuitJson, null, 2),
  )
  await writeFile(
    new URL("passive-values-pcb-circuit-json.svg", snapshotsDir),
    convertCircuitJsonToPcbSvg(pcbCircuitJson, { showCourtyards: true }),
  )

  const kicadSnapshot = await takeKicadSnapshot({
    kicadFileContent: pcbContent,
    kicadFileType: "pcb",
    generatePng: false,
  })
  // Render the native SVG at the same height as the Circuit JSON PCB image.
  const kicadPng = await sharp(
    kicadSnapshot.generatedFileContent["temp_file.svg"],
    { density: 300 },
  )
    .resize({ height: 1280 })
    .flatten({ background: "#000000" })
    .png()
    .toBuffer()
  const circuitJsonPng = await takeCircuitJsonSnapshot({
    circuitJson: pcbCircuitJson,
    outputType: "pcb",
  })
  const stackedPng = await stackCircuitJsonKicadPngs(circuitJsonPng, kicadPng)
  await expect(stackedPng).toMatchPngSnapshot(
    import.meta.path,
    "passive-values-pcb",
  )
}, 30_000)

// These describe the desired behavior without making a repro-only PR red.
// Remove .failing when the converter starts preserving the electrical values.
test.failing("R1 should have a valid numeric resistance of 10000 ohms", () => {
  expect(source_simple_resistor.safeParse(resistor).success).toBe(true)
  expect(resistor).toMatchObject({ resistance: 10_000 })
})

test.failing("C1 should have a valid numeric capacitance of 100 nF", () => {
  expect(source_simple_capacitor.safeParse(capacitor).success).toBe(true)
  expect(capacitor?.ftype).toBe("simple_capacitor")
  if (capacitor?.ftype !== "simple_capacitor") {
    throw new Error("Expected the capacitor from the reproduction fixture")
  }
  expect(typeof capacitor.capacitance).toBe("number")
  expect(capacitor.capacitance).toBeCloseTo(100e-9, 12)
})
