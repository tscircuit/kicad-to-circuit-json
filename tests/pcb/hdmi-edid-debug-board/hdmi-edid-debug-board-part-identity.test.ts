import { expect, test } from "bun:test"
import "bun-match-svg"
import { readFileSync } from "node:fs"
import { source_component_base } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { parseKicadPcb } from "kicadts"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"

const svgContents = (svg: string) =>
  svg
    .replace(/^[\s\S]*?<svg\b[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<title>[\s\S]*?<\/title>/, "")

const escapeXml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

test("repro4948: HDMI EDID board preserves components but loses manufacturer and MPN on import", async () => {
  const filename = "tests/assets/hdmi-edid-debug-board.kicad_pcb"
  const content = readFileSync(filename, "utf8")
  const source = parseKicadPcb(content)
  const parts = source.footprints.map((footprint) => {
    const properties = Object.fromEntries(
      footprint.properties.map((property) => [property.key, property.value]),
    )
    return {
      footprint,
      reference: properties.Reference!,
      mpn: properties.MPN || undefined,
      manufacturer: properties.Manufacturer || undefined,
    }
  })
  const identifiedParts = parts.filter((part) => part.mpn)
  const manufacturers = parts.filter((part) => part.manufacturer)
  expect(parts).toHaveLength(110)
  expect(identifiedParts).toHaveLength(98)
  expect(manufacturers).toHaveLength(98)
  expect(parts.find((part) => part.reference === "R11")).toMatchObject({
    mpn: "CR0402-FX-5101GLF",
    manufacturer: "Bourns",
  })

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("hdmi-edid-debug-board.kicad_pcb", content)
  converter.runUntilFinished()
  const circuitJson = converter.getOutput()
  const components = circuitJson.filter(
    (item) => item.type === "source_component",
  )
  const pcbComponents = circuitJson.filter(
    (item) => item.type === "pcb_component",
  )
  expect(components).toHaveLength(parts.length)
  expect(pcbComponents).toHaveLength(parts.length)
  for (const part of parts) {
    const component = components.find((item) => item.name === part.reference)
    if (!component) throw new Error(`Missing component ${part.reference}`)
    expect(component.manufacturer_part_number).toBeUndefined()
    expect(
      source_component_base.parse(component).manufacturer_part_number,
    ).toBe(component.manufacturer_part_number)
  }
  const importedMpns = components.filter(
    (item) => item.manufacturer_part_number,
  )
  expect(importedMpns).toHaveLength(0)
  const manufacturerWarnings = converter
    .getWarnings()
    .filter((message) => message.includes("Manufacturer"))
  expect(manufacturerWarnings).toEqual([])

  const samples = ["R11", "Q1", "J5"].map((reference) => {
    const part = parts.find((item) => item.reference === reference)!
    const component = components.find((item) => item.name === reference)!
    const pcbComponent = pcbComponents.find(
      (item) => item.source_component_id === component.source_component_id,
    )!
    return { ...part, component, pcbComponent }
  })
  const board = circuitJson.find((item) => item.type === "pcb_board")
  if (!board?.width || !board.height) throw new Error("Missing board bounds")
  const width = board.width + 8
  const height = board.height + 8
  const minX = -width / 2
  const maxY = height / 2
  const first = samples[0]!
  const centerX = first.footprint.position!.x - first.pcbComponent.center.x
  const centerY = first.footprint.position!.y + first.pcbComponent.center.y
  const original = await takeKicadSnapshot({
    kicadFileContent: content,
    kicadFileType: "pcb",
    generatePng: false,
    pcbSnapshotBounds: "circuit-json",
  })
  const originalSvg = Object.values(
    original.generatedFileContent,
  )[0]!.toString()
  const importedSvg = convertCircuitJsonToPcbSvg(
    circuitJson.filter((item) => !item.type.startsWith("pcb_fabrication")),
    {
      width,
      height,
      viewport: { minX, maxX: -minX, minY: -maxY, maxY },
      showCourtyards: false,
      showPcbNotes: false,
      includeVersion: false,
    },
  )
  const markers = (original: boolean) =>
    samples
      .map(({ footprint, pcbComponent, reference }) => {
        const x = original
          ? footprint.position!.x
          : pcbComponent.center.x - minX
        const y = original
          ? footprint.position!.y
          : maxY - pcbComponent.center.y
        return `<circle cx="${x}" cy="${y}" r="1.9" fill="none" stroke="#f9d56e" stroke-width="0.3"/>
<text x="${x + 2.3}" y="${y - 2}" font-family="sans-serif" font-size="2.2" fill="#f9d56e" stroke="#101820" stroke-width="0.6" paint-order="stroke">${reference}</text>`
      })
      .join("")
  const lostMpns = identifiedParts.length - importedMpns.length
  const statusColor = lostMpns ? "#ff8585" : "#8fd6a7"
  const rows = samples
    .map((part, index) => {
      const y = 786 + index * 44
      const reported = manufacturerWarnings.some((message) =>
        message.startsWith(`Footprint ${part.reference}: Manufacturer `),
      )
      return `<text x="40" y="${y}">${part.reference}</text>
<text x="155" y="${y}">${escapeXml(part.manufacturer!)} / ${escapeXml(part.mpn!)}</text>
<text x="732" y="${y}" fill="${statusColor}">${escapeXml(part.component.manufacturer_part_number ?? "MPN lost")}</text>
<text x="1060" y="${y}" fill="${reported ? "#f9d56e" : "#ff8585"}">${reported ? "Unsupported; warning emitted" : "Lost without warning"}</text>`
    })
    .join("")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="950" viewBox="0 0 1440 950">
<rect width="100%" height="100%" fill="#101820"/>
<g font-family="sans-serif" fill="white">
<text x="24" y="38" font-size="26">HDMI EDID Debug Board — manufacturer part identity</text>
<text x="24" y="80" font-size="21">Original KiCad · full board</text>
<text x="732" y="80" font-size="21">Current Circuit JSON import · full board</text>
<text x="24" y="112" font-size="18" fill="#8fd6a7">${parts.length} components · ${identifiedParts.length} MPNs · ${manufacturers.length} manufacturer names</text>
<text x="732" y="112" font-size="18" fill="${statusColor}">${components.length} components · ${importedMpns.length} MPNs preserved · ${lostMpns} lost</text>
<text x="732" y="142" font-size="17" fill="${manufacturerWarnings.length ? "#f9d56e" : "#ff8585"}">Manufacturer names not imported: ${manufacturers.length} · warnings: ${manufacturerWarnings.length}</text>
<g font-size="18" fill="#b8c7d3">
<text x="40" y="740">Reference</text><text x="155" y="740">Original manufacturer / MPN</text>
<text x="732" y="740">Imported MPN</text><text x="1060" y="740">Manufacturer name</text>
</g>
<g font-size="18">${rows}</g>
<text x="24" y="927" font-size="17" fill="#b8c7d3">Metadata is checked for all 110 components. Highlighted examples link the table to the full-board views.</text>
</g>
<rect x="24" y="162" width="684" height="545" fill="black" stroke="#425563"/>
<svg x="24" y="162" width="684" height="545" viewBox="${centerX + minX} ${centerY - maxY} ${width} ${height}" preserveAspectRatio="xMidYMid meet">${svgContents(originalSvg)}${markers(true)}</svg>
<rect x="732" y="162" width="684" height="545" fill="black" stroke="#425563"/>
<svg x="732" y="162" width="684" height="545" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">${svgContents(importedSvg)}${markers(false)}</svg>
</svg>`
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
}, 30_000)
