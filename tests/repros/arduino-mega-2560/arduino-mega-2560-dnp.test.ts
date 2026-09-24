import { expect, test } from "bun:test"
import "bun-match-svg"
import { readFileSync } from "node:fs"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { parseKicadPcb } from "kicadts"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"

test("repro4948: Arduino Mega 2560 preserves components but loses DNP status on import", async () => {
  const filename = "tests/assets/Arduino Mega 2560.kicad_pcb"
  const content = readFileSync(filename, "utf8")
  const source = parseKicadPcb(content)
  const sourceDnp = source.footprints.filter((footprint) => footprint.attr?.dnp)
  const references = sourceDnp.map(
    (footprint) =>
      footprint.properties.find((property) => property.key === "Reference")!
        .value,
  )
  expect(references.toSorted()).toEqual(["R1", "R2"])
  expect(source.footprints).toHaveLength(66)

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("arduino-mega-2560.kicad_pcb", content)
  converter.runUntilFinished()
  const circuitJson = converter.getOutput()
  const sourceComponents = circuitJson.filter(
    (element) => element.type === "source_component",
  )
  const names = Object.fromEntries(
    sourceComponents.map((component) => [
      component.source_component_id,
      component.name,
    ]),
  )
  const components = circuitJson.filter(
    (element) => element.type === "pcb_component",
  )
  const importedDnp = components.filter((component) => component.do_not_place)
  expect(sourceComponents).toHaveLength(66)
  expect(components).toHaveLength(66)
  expect(
    importedDnp.map((component) => names[component.source_component_id]).sort(),
  ).toEqual([])

  const smtPads = circuitJson.filter((element) => element.type === "pcb_smtpad")
  const targets = sourceDnp.map((footprint, index) => {
    const reference = references[index]!
    const component = components.find(
      (candidate) => names[candidate.source_component_id] === reference,
    )
    if (!component || !footprint.position) {
      throw new Error(`Missing DNP footprint ${reference}`)
    }
    const pads = smtPads.filter(
      (pad) => pad.pcb_component_id === component.pcb_component_id,
    )
    expect(pads).toHaveLength(2)
    expect(pads.map((pad) => pad.port_hints?.[0]).sort()).toEqual(["1", "2"])
    return { reference, footprint, component }
  })
  for (const component of components) {
    if (!references.includes(names[component.source_component_id]!)) {
      expect(component.do_not_place).not.toBe(true)
    }
  }

  const board = circuitJson.find((element) => element.type === "pcb_board")
  if (!board?.width || !board.height) throw new Error("Missing board bounds")
  const width = board.width + 8
  const height = board.height + 8
  const minX = -width / 2
  const maxY = height / 2
  const first = targets[0]!
  const centerX = first.footprint.position!.x - first.component.center.x
  const centerY = first.footprint.position!.y + first.component.center.y
  const sourceSnapshot = await takeKicadSnapshot({
    kicadFilePath: filename,
    kicadFileType: "pcb",
    generatePng: false,
    pcbSnapshotBounds: "circuit-json",
  })
  const sourceSvg = Object.values(sourceSnapshot.generatedFileContent)[0]!
  const importedSvg = convertCircuitJsonToPcbSvg(circuitJson, {
    width,
    height,
    viewport: { minX, maxX: -minX, minY: -maxY, maxY },
    showCourtyards: false,
    showPcbNotes: false,
    includeVersion: false,
  })
  const contents = (svg: string) =>
    svg.replace(/^[\s\S]*?<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "")
  const markers = (original: boolean) =>
    targets
      .map(({ reference, footprint, component }) => {
        const x = original ? footprint.position!.x : component.center.x - minX
        const y = original ? footprint.position!.y : maxY - component.center.y
        const dnp = original ? footprint.attr!.dnp : component.do_not_place
        const color = dnp ? "#8fd6a7" : "#ff8585"
        return `<circle cx="${x}" cy="${y}" r="2.2" fill="none" stroke="${color}" stroke-width="0.35"/>
<rect x="${x + 3}" y="${y - 3.4}" width="22" height="3.8" rx="0.5" fill="#101820"/>
<text x="${x + 4}" y="${y - 0.7}" font-family="sans-serif" font-size="2.5" fill="${color}">${reference}: ${dnp ? "DNP" : "DNP lost"}</text>`
      })
      .join("")
  const lost = sourceDnp.length - importedDnp.length
  const statusColor = lost ? "#ff8585" : "#8fd6a7"
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="620" viewBox="0 0 1440 620">
<rect width="100%" height="100%" fill="#101820"/>
<g font-family="sans-serif" fill="white">
<text x="24" y="38" font-size="26">Arduino Mega 2560 — Do Not Populate (DNP)</text>
<text x="24" y="80" font-size="21">Original KiCad · full board</text>
<text x="732" y="80" font-size="21">Current Circuit JSON import · full board</text>
<text x="24" y="110" font-size="18" fill="#8fd6a7">${source.footprints.length} components · ${sourceDnp.length} DNP · R1, R2</text>
<text x="732" y="110" font-size="18" fill="${statusColor}">${components.length} components · ${importedDnp.length} DNP · ${lost} DNP flags lost</text>
<text x="24" y="570" font-size="18">R1 and R2 stay in the design with all four copper pads.</text>
<text x="24" y="600" font-size="17" fill="#b8c7d3">Labels show assembly status from each representation; DNP does not remove PCB copper.</text>
</g>
<rect x="24" y="128" width="684" height="410" fill="black" stroke="#425563"/>
<svg x="24" y="128" width="684" height="410" viewBox="${centerX + minX} ${centerY - maxY} ${width} ${height}" preserveAspectRatio="xMidYMid meet">${contents(sourceSvg.toString())}${markers(true)}</svg>
<rect x="732" y="128" width="684" height="410" fill="black" stroke="#425563"/>
<svg x="732" y="128" width="684" height="410" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">${contents(importedSvg)}${markers(false)}</svg>
</svg>`
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
}, 30_000)
