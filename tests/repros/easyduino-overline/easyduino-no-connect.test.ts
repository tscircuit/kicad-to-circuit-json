import { expect, test } from "bun:test"
import "bun-match-svg"
import { readFileSync } from "node:fs"
import { convertCircuitJsonToSchematicSvg } from "circuit-to-svg"
import { parseKicadSch } from "kicadts"
import sharp from "sharp"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"

const svgContents = (svg: string) =>
  svg.replace(/^[\s\S]*?<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "")

test("repro4948: Easyduino schematic preserves all 16 electrical NC constraints", async () => {
  const filename = "tests/assets/Easyduino_ESP32.kicad_sch"
  const content = readFileSync(filename, "utf8")
  const source = parseKicadSch(content)
  const symbol = source.symbols.find((symbol) =>
    symbol.properties.some(
      (property) => property.key === "Reference" && property.value === "U1",
    ),
  )!
  expect(symbol.at).toMatchObject({ x: 144.78, y: 72.39, angle: 0 })
  expect(symbol.mirror).toBeUndefined()
  const library = source.libSymbols!.symbols.find(
    (library) => library.libraryId === symbol.libraryId,
  )!
  const pins = library.subSymbols.flatMap((part) => part.pins)
  expect(source.noConnects).toHaveLength(15)
  const markerPins = source.noConnects.map((marker) => {
    // This source instance is unrotated and unmirrored. Library pin Y is up;
    // sheet Y is down. Match its raw endpoints independently of the importer.
    const matches = pins.filter(
      (pin) =>
        pin.at &&
        Math.abs(symbol.at!.x + pin.at.x - marker.at!.x) < 1e-6 &&
        Math.abs(symbol.at!.y - pin.at.y - marker.at!.y) < 1e-6,
    )
    expect(matches).toHaveLength(1)
    return Number(matches[0]!.numberString)
  })
  const intrinsicPins = pins.filter(
    (pin) => pin.pinElectricalType === "no_connect",
  )
  expect(intrinsicPins.map((pin) => pin.numberString)).toEqual(["10"])
  // Independently confirmed with native KiCad's exported netlist.
  const ncPinNumbers = [
    1, 2, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 27,
  ]
  expect([...markerPins, 10].sort((a, b) => a - b)).toEqual(ncPinNumbers)

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("Easyduino_ESP32.kicad_sch", content)
  converter.runUntilFinished()
  const circuitJson = converter.getOutput()
  const sourceComponents = circuitJson.filter(
    (item) => item.type === "source_component",
  )
  const u1Components = sourceComponents.filter(
    (item) => item.name === symbol.libraryId,
  )
  expect(u1Components).toHaveLength(1)
  const sourcePorts = circuitJson.filter((item) => item.type === "source_port")
  const u1Ports = sourcePorts.filter(
    (port) => port.source_component_id === u1Components[0]!.source_component_id,
  )
  const schematicPorts = circuitJson.filter(
    (item) => item.type === "schematic_port",
  )
  const ncPorts = ncPinNumbers.map((number) => {
    const port = u1Ports.find((port) => port.pin_number === number)!
    expect(port).toBeDefined()
    expect(port.do_not_connect).toBe(true)
    const schematicPort = schematicPorts.find(
      (item) => item.source_port_id === port.source_port_id,
    )!
    const pin = pins.find((pin) => pin.numberString === String(number))!
    expect(schematicPort.center.x).toBeCloseTo(
      (symbol.at!.x + pin.at!.x - 105) / 15,
      6,
    )
    expect(schematicPort.center.y).toBeCloseTo(
      (148.5 - symbol.at!.y + pin.at!.y) / 15,
      6,
    )
    return port
  })
  const markedPorts = sourcePorts.filter((port) => port.do_not_connect)
  expect(markedPorts).toHaveLength(ncPinNumbers.length)
  expect(converter.getWarnings()).toEqual([])
  const ncIds = new Set(ncPorts.map((port) => port.source_port_id))
  expect(
    sourcePorts.filter(
      (port) => !ncIds.has(port.source_port_id) && port.do_not_connect,
    ),
  ).toHaveLength(0)

  const original = await takeKicadSnapshot({
    kicadFilePath: filename,
    kicadFileType: "sch",
    generatePng: false,
    excludeDrawingSheet: true,
  })
  const originalSvg = Object.values(
    original.generatedFileContent,
  )[0]!.toString()
  const sourceViewBox = originalSvg.match(/viewBox="([^"]+)"/)?.[1]
  if (!sourceViewBox) throw new Error("Missing native schematic viewBox")
  const [pageX, pageY, pageWidth, pageHeight] = sourceViewBox
    .split(/\s+/)
    .map(Number)
  const nativeImage = sharp(Buffer.from(originalSvg))
  const metadata = await nativeImage.metadata()
  const { info } = await nativeImage
    .trim()
    .png()
    .toBuffer({ resolveWithObject: true })
  // Fit all native artwork, removing blank paper only. Round out to a 5 mm
  // grid with a margin so text and anti-aliasing never make the crop too tight.
  const left =
    pageX! - ((info.trimOffsetLeft ?? 0) * pageWidth!) / metadata.width!
  const top =
    pageY! - ((info.trimOffsetTop ?? 0) * pageHeight!) / metadata.height!
  const right = left + (info.width * pageWidth!) / metadata.width!
  const bottom = top + (info.height * pageHeight!) / metadata.height!
  const cropX = Math.floor(left / 5) * 5 - 5
  const cropY = Math.floor(top / 5) * 5 - 5
  const sourceView = `${cropX} ${cropY} ${Math.ceil(right / 5) * 5 + 5 - cropX} ${Math.ceil(bottom / 5) * 5 + 5 - cropY}`
  const importedSvg = convertCircuitJsonToSchematicSvg(circuitJson, {
    width: 684,
    height: 460,
    includeVersion: false,
  })
  const rows = ncPorts
    .map((port, index) => {
      const x = index < 8 ? 24 : 732
      const y = 670 + (index % 8) * 29
      return `<text x="${x}" y="${y}">U1 · pin ${port.pin_number}</text>
<text x="${x + 170}" y="${y}">${port.pin_number === 10 ? "Pin type no_connect" : "Explicit NC marker"}</text>
<text x="${x + 440}" y="${y}" fill="${port.do_not_connect ? "#8fd6a7" : "#ff8585"}">${port.do_not_connect ? "NC preserved" : "NC flag lost"}</text>`
    })
    .join("")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="940" viewBox="0 0 1440 940">
<rect width="1440" height="940" fill="#101820"/>
<g font-family="sans-serif" fill="white">
<text x="24" y="38" font-size="26">Easyduino ESP32 — schematic no-connect constraints</text>
<text x="24" y="80" font-size="21">Original KiCad · complete schematic</text>
<text x="732" y="80" font-size="21">Circuit JSON import · complete schematic</text>
<text x="24" y="110" font-size="18" fill="#8fd6a7">15 explicit markers + 1 intrinsic NC pin = 16 NC terminals</text>
<text x="732" y="110" font-size="18" fill="${markedPorts.length ? "#8fd6a7" : "#ff8585"}">${markedPorts.length} electrical NC flags preserved · ${16 - markedPorts.length} lost</text>
<rect x="24" y="130" width="684" height="460" fill="white"/><rect x="732" y="130" width="684" height="460" fill="white"/>
<svg x="24" y="130" width="684" height="460" viewBox="${sourceView}" preserveAspectRatio="xMidYMid meet">${svgContents(originalSvg)}</svg>
<svg x="732" y="130" width="684" height="460" viewBox="0 0 684 460">${svgContents(importedSvg)}</svg>
<text x="24" y="625" font-size="21">Native KiCad netlist confirms the same 16 U1 pins; pin identities and positions remain unchanged.</text>
<g font-size="18">${rows}</g>
<text x="24" y="917" font-size="17">Drawing a cross does not retain the logical do_not_connect constraint. Explicit markers and intrinsic NC types both matter.</text>
</g></svg>`
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
}, 30_000)
