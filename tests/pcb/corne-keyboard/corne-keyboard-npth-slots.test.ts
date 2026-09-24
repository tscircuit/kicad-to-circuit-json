import { expect, test } from "bun:test"
import "bun-match-svg"
import { readFileSync } from "node:fs"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { parseKicadPcb } from "kicadts"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"

function svgContents(svg: string): string {
  return svg
    .replace(/^[\s\S]*?<svg\b[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<title>[\s\S]*?<\/title>/, "")
}

test("repro4948: Corne Keyboard preserves all 46 NPTH slots on import", async () => {
  const filename = "tests/assets/corne-keyboard/corne-keyboard.kicad_pcb"
  const content = readFileSync(filename, "utf8")
  const source = parseKicadPcb(content)
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("corne-keyboard.kicad_pcb", content)
  converter.runUntilFinished()
  const circuitJson = converter.getOutput()
  const board = circuitJson.find((element) => element.type === "pcb_board")
  if (!board?.width || !board.height) throw new Error("Missing board bounds")
  const components = circuitJson.filter(
    (element) => element.type === "pcb_component",
  )
  const names = Object.fromEntries(
    circuitJson
      .filter((element) => element.type === "source_component")
      .map((component) => [component.source_component_id, component.name]),
  )
  const holes = circuitJson
    .filter((element) => element.type === "pcb_hole")
    .filter((hole) => hole.pcb_component_id !== undefined)
  const sourceHoles = source.footprints.flatMap((footprint) =>
    footprint.fpPads.filter((pad) => pad.padType === "np_thru_hole"),
  )
  const sourceSlots = sourceHoles.filter((pad) => pad.drill?.oval)
  const importedSlots = holes.filter((hole) => hole.hole_shape !== "circle")
  expect(sourceHoles).toHaveLength(332)
  expect(sourceSlots).toHaveLength(46)
  expect(holes).toHaveLength(sourceHoles.length)
  expect(importedSlots).toHaveLength(sourceSlots.length)
  expect(circuitJson.filter((e) => e.type === "pcb_plated_hole")).toHaveLength(
    source.footprints.flatMap((f) =>
      f.fpPads.filter((pad) => pad.padType === "thru_hole"),
    ).length,
  )

  const slots = source.footprints.flatMap((footprint) => {
    const pads = footprint.fpPads.filter(
      (pad) => pad.padType === "np_thru_hole",
    )
    if (pads.length === 0) return []
    const reference = footprint.fpTexts.find(
      (text) => text.type === "reference",
    )?.text
    const component = components.find(
      (candidate) => names[candidate.source_component_id] === reference,
    )
    if (!component || !footprint.position) {
      throw new Error(`Missing NPTH footprint ${reference}`)
    }
    const imported = holes.filter(
      (hole) => hole.pcb_component_id === component.pcb_component_id,
    )
    expect(imported).toHaveLength(pads.length)
    const angle =
      "angle" in footprint.position ? (footprint.position.angle ?? 0) : 0
    const radians = (angle * Math.PI) / 180

    return pads.flatMap((pad, index) => {
      const hole = imported[index]!
      const at = pad.at!
      // KiCad positions are footprint-local and Y-down; CJ holes are Y-up.
      const dx = at.x * Math.cos(radians) + at.y * Math.sin(radians)
      const dy = at.x * Math.sin(radians) - at.y * Math.cos(radians)
      expect(hole.x).toBeCloseTo(component.center.x + dx, 6)
      expect(hole.y).toBeCloseTo(component.center.y + dy, 6)
      if (!pad.drill?.oval) {
        expect(hole).toMatchObject({
          type: "pcb_hole",
          hole_shape: "circle",
          hole_diameter: pad.drill!.diameter,
        })
        return []
      }
      expect(hole).toMatchObject({
        type: "pcb_hole",
        hole_shape: "rotated_pill",
        hole_width: pad.drill.diameter,
        hole_height: pad.drill.width,
        ccw_rotation: pad.at!.angle,
      })
      return [{ reference, pad, hole, component, footprint }]
    })
  })
  expect(slots).toHaveLength(46)
  expect(
    [...new Set(slots.map(({ pad }) => pad.at!.angle ?? 0))].sort(
      (a, b) => a - b,
    ),
  ).toEqual([113.88, 168.061, 180, 191.94, 246.12])

  const sample = slots.find((slot) => slot.reference === "SW1")!
  const centerX = sample.footprint.position!.x - sample.component.center.x
  const centerY = sample.footprint.position!.y + sample.component.center.y
  const width = board.width + 4
  const height = board.height + 4
  const minX = -width / 2
  const maxY = height / 2
  const sourceSnapshot = await takeKicadSnapshot({
    kicadFilePath: filename,
    kicadFileType: "pcb",
    generatePng: false,
    // Keep native board coordinates so both views can crop the same opening.
    pcbSnapshotBounds: "circuit-json",
  })
  const sourceSvg = Object.values(sourceSnapshot.generatedFileContent)[0]!
  const importedSvg = convertCircuitJsonToPcbSvg(
    circuitJson.filter(
      (element) => !element.type.startsWith("pcb_fabrication"),
    ),
    {
      width,
      height,
      viewport: { minX, maxX: -minX, minY: -maxY, maxY },
      showCourtyards: false,
      showPcbNotes: false,
      includeVersion: false,
      colorOverrides: { drill: "#e2e8f0", substrate: "#263440" },
    },
  )
  const sourceView = `${centerX + minX} ${centerY - maxY} ${width} ${height}`
  const importedView = `0 0 ${width} ${height}`
  const sourceCrop = `${sample.hole.x + centerX - 4} ${centerY - sample.hole.y - 2} 8 4`
  const importedCrop = `${sample.hole.x - minX - 4} ${maxY - sample.hole.y - 2} 8 4`
  const panel = (
    id: string,
    viewBox: string,
    x: number,
    y: number,
    h: number,
  ) =>
    `<rect x="${x}" y="${y}" width="684" height="${h}" fill="black" stroke="#425563"/>
<svg x="${x}" y="${y}" width="684" height="${h}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet"><use href="#${id}"/></svg>`

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">
<rect width="100%" height="100%" fill="#101820"/>
<defs><g id="original">${svgContents(sourceSvg.toString())}</g><g id="imported">${svgContents(importedSvg)}</g></defs>
<g font-family="sans-serif" fill="white">
<text x="24" y="38" font-size="26">Corne Keyboard — non-plated mounting slots</text>
<text x="24" y="80" font-size="21">Original KiCad · full board</text>
<text x="732" y="80" font-size="21">Fixed Circuit JSON import · full board</text>
<text x="24" y="110" font-size="18" fill="#8fd6a7">${sourceHoles.length} footprint NPTH holes · ${sourceSlots.length} slots</text>
<text x="732" y="110" font-size="18" fill="#8fd6a7">${holes.length} footprint NPTH holes · ${importedSlots.length} slots · ${sourceSlots.length - importedSlots.length} lost</text>
<text x="24" y="477" font-size="21">SW1 slot close-up · original</text>
<text x="732" y="477" font-size="21">SW1 slot close-up · imported</text>
<text x="24" y="507" font-size="18" fill="#8fd6a7">${sample.pad.drill!.diameter} × ${sample.pad.drill!.width} mm slot · ${sample.pad.at!.angle}° CCW</text>
<text x="732" y="507" font-size="18" fill="#8fd6a7">1.5 × 2 mm slot · 246.12° CCW preserved</text>
<text x="24" y="882" font-size="16">Same physical area in both close-ups · hole centers and NPTH count remain unchanged</text>
</g>
${panel("original", sourceView, 24, 128, 300)}
${panel("imported", importedView, 732, 128, 300)}
${panel("original", sourceCrop, 24, 525, 330)}
${panel("imported", importedCrop, 732, 525, 330)}
</svg>`
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
}, 30_000)
