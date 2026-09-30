import { expect, test } from "bun:test"
import "bun-match-svg"
import { readFileSync } from "node:fs"
import { source_component_base } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { parseKicadPcb } from "kicadts"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"

const contents = (svg: string) =>
  svg
    .replace(/^[\s\S]*?<svg\b[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<title>[\s\S]*?<\/title>/, "")
const escapeXml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

test("repro4948: HDMI EDID board preserves all component Value labels separately from MPNs", async () => {
  const content = readFileSync(
    "tests/assets/hdmi-edid-debug-board.kicad_pcb",
    "utf8",
  )
  const source = parseKicadPcb(content)
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("hdmi-edid-debug-board.kicad_pcb", content)
  converter.runUntilFinished()
  const circuitJson = converter.getOutput()
  const components = circuitJson.filter((e) => e.type === "source_component")
  const pcbComponents = circuitJson.filter((e) => e.type === "pcb_component")
  const parts = source.footprints.map((footprint) => {
    const properties = Object.fromEntries(
      footprint.properties.map((p) => [p.key, p.value]),
    )
    const component = components.find((c) => c.name === properties.Reference)
    if (!component) throw new Error(`Missing ${properties.Reference}`)
    const value = properties.Value!
    expect(value).toBeTruthy()
    expect(component.display_value).toBe(value)
    expect(source_component_base.parse(component).display_value).toEqual(
      component.display_value,
    )
    expect(component.manufacturer_part_number).toBe(properties.MPN || undefined)
    const typedValue =
      component.ftype === "simple_resistor"
        ? component.resistance
        : component.ftype === "simple_capacitor"
          ? component.capacitance
          : component.ftype === "simple_inductor"
            ? component.inductance
            : undefined
    if (typedValue !== undefined)
      expect(String(typedValue)).toEqual(value.replaceAll(",", "."))
    return {
      footprint,
      reference: properties.Reference!,
      component,
      value,
      typedValue,
    }
  })
  const generic = parts.filter((p) => p.typedValue === undefined)
  const preserved = generic.filter(
    (p) => p.component.display_value === p.value,
  ).length
  expect(parts).toHaveLength(110)
  expect(generic).toHaveLength(53)
  expect(preserved).toBe(53)
  const samples = ["J5", "D1", "Q1"].map(
    (ref) => parts.find((p) => p.reference === ref)!,
  )
  expect(samples[0]).toMatchObject({
    value: "USB-C_GCT_USB4105-GF-A",
    component: { manufacturer_part_number: "USB4105-GF-A" },
  })
  expect(samples[1]).toMatchObject({
    value: "PESD5Z5_0F",
    component: { manufacturer_part_number: "PESD5Z5.0F" },
  })
  const first = samples[0]!
  const pcbComponent = pcbComponents.find(
    (c) => c.source_component_id === first.component.source_component_id,
  )!
  const board = circuitJson.find((e) => e.type === "pcb_board")
  if (!board?.width || !board.height) throw new Error("Missing board bounds")
  const width = board.width + 8
  const height = board.height + 8
  const centerX = first.footprint.position!.x - pcbComponent.center.x
  const centerY = first.footprint.position!.y + pcbComponent.center.y
  const native = await takeKicadSnapshot({
    kicadFileContent: content,
    kicadFileType: "pcb",
    generatePng: false,
    pcbSnapshotBounds: "circuit-json",
  })
  const nativeSvg = Object.values(native.generatedFileContent)[0]!.toString()
  const importedSvg = convertCircuitJsonToPcbSvg(
    circuitJson.filter((e) => !e.type.startsWith("pcb_fabrication")),
    {
      width,
      height,
      viewport: {
        minX: -width / 2,
        maxX: width / 2,
        minY: -height / 2,
        maxY: height / 2,
      },
      showCourtyards: false,
      showPcbNotes: false,
      includeVersion: false,
    },
  )
  const rows = samples
    .map((p, index) => {
      const y = 757 + index * 64
      return `<text x="32" y="${y}">${p.reference} · Value: ${escapeXml(p.value)}</text><text x="32" y="${y + 25}" font-size="16" fill="#b8c7d3">MPN: ${escapeXml(p.component.manufacturer_part_number!)}</text><text x="732" y="${y}" fill="${p.component.display_value ? "#8fd6a7" : "#ff8585"}">${p.component.display_value ? escapeXml(p.component.display_value) : "Source-component Value missing"}</text><text x="732" y="${y + 25}" font-size="16" fill="#b8c7d3">MPN remains ${escapeXml(p.component.manufacturer_part_number!)}</text>`
    })
    .join("")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1010" viewBox="0 0 1440 1010">
<rect width="100%" height="100%" fill="#101820"/>
<g font-family="sans-serif" fill="white">
<text x="24" y="38" font-size="26">HDMI EDID Debug Board — component Value labels</text>
<text x="24" y="78" font-size="21">Original KiCad · full board</text><text x="732" y="78" font-size="21">Current Circuit JSON import · full board</text>
<text x="24" y="110" font-size="18" fill="#8fd6a7">110 Value properties · 53 parts without a typed passive value</text><text x="732" y="110" font-size="18" fill="${preserved ? "#8fd6a7" : "#ff8585"}">${preserved} of those 53 labels preserved · ${generic.length - preserved} lost</text>
<text x="24" y="714" font-size="21">Original Value and distinct MPN</text><text x="732" y="714" font-size="21">Imported source-component metadata</text>
<g font-size="20">${rows}</g>
<text x="24" y="960" font-size="18">All 57 resistor/capacitor/inductor values and existing MPNs remain unchanged.</text>
<text x="24" y="990" font-size="17" fill="#b8c7d3">The source-component Value is checked separately from rendered text and manufacturer part numbers.</text>
</g>
<rect x="24" y="140" width="684" height="540" fill="black" stroke="#425563"/><svg x="24" y="140" width="684" height="540" viewBox="${centerX - width / 2} ${centerY - height / 2} ${width} ${height}" preserveAspectRatio="xMidYMid meet">${contents(nativeSvg)}</svg>
<rect x="732" y="140" width="684" height="540" fill="black" stroke="#425563"/><svg x="732" y="140" width="684" height="540" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">${contents(importedSvg)}</svg>
</svg>`
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
}, 30_000)
