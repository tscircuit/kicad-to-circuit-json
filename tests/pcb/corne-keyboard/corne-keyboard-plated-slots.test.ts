import { expect, test } from "bun:test"
import "bun-match-svg"
import { readFileSync } from "node:fs"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { parseKicadPcb } from "kicadts"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"

const svgContents = (svg: string) =>
  svg
    .replace(/^[\s\S]*?<svg\b[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<title>[\s\S]*?<\/title>/, "")

test("repro4948: Corne Keyboard preserves circular copper pads but loses 20 plated slots on import", async () => {
  const content = readFileSync(
    "tests/assets/corne-keyboard/corne-keyboard.kicad_pcb",
    "utf8",
  )
  const source = parseKicadPcb(content)
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("corne-keyboard.kicad_pcb", content)
  converter.runUntilFinished()
  const circuitJson = converter.getOutput()
  const board = circuitJson.find((item) => item.type === "pcb_board")
  if (!board?.width || !board.height) throw new Error("Missing board bounds")
  const components = circuitJson.filter((item) => item.type === "pcb_component")
  const names = Object.fromEntries(
    circuitJson
      .filter((item) => item.type === "source_component")
      .map((item) => [item.source_component_id, item.name]),
  )
  const holes = circuitJson.filter((item) => item.type === "pcb_plated_hole")
  const ports = circuitJson.filter((item) => item.type === "pcb_port")
  const traces = circuitJson.filter((item) => item.type === "source_trace")
  const nets = circuitJson.filter((item) => item.type === "source_net")
  expect(holes).toHaveLength(
    source.footprints.flatMap((footprint) =>
      footprint.fpPads.filter((pad) => pad.padType === "thru_hole"),
    ).length,
  )

  const slots = source.footprints.flatMap((footprint) => {
    const pads = footprint.fpPads.filter(
      (pad) =>
        pad.padType === "thru_hole" &&
        pad.shape === "circle" &&
        pad.drill?.oval,
    )
    if (!pads.length) return []
    const reference = footprint.fpTexts.find(
      (text) => text.type === "reference",
    )!.text
    const component = components.find(
      (item) => names[item.source_component_id] === reference,
    )!
    const angle =
      footprint.position && "angle" in footprint.position
        ? (footprint.position.angle ?? 0)
        : 0
    const radians = (angle * Math.PI) / 180
    return pads.map((pad) => {
      const matches = holes.filter(
        (hole) =>
          hole.pcb_component_id === component.pcb_component_id &&
          hole.port_hints?.includes(pad.number),
      )
      expect(matches).toHaveLength(1)
      const hole = matches[0]!
      expect(pad.drill!.diameter).toBe(1)
      expect(pad.drill!.width).toBe(0.5)
      expect(pad.size!.width).toBe(1.2)
      expect(pad.size!.height).toBe(1.2)
      const at = pad.at!
      // KiCad pad XY is footprint-local and Y-down; Circuit JSON is world-space and Y-up.
      expect(hole.x).toBeCloseTo(
        component.center.x +
          at.x * Math.cos(radians) +
          at.y * Math.sin(radians),
        6,
      )
      expect(hole.y).toBeCloseTo(
        component.center.y +
          at.x * Math.sin(radians) -
          at.y * Math.cos(radians),
        6,
      )
      expect(hole.layers).toEqual(["top", "bottom"])
      expect(hole).toMatchObject({
        shape: "circle",
        hole_diameter: 1,
        outer_diameter: 1.2,
      })
      const port = ports.find((item) => item.pcb_port_id === hole.pcb_port_id)!
      const connectedNets = traces
        .filter((trace) =>
          trace.connected_source_port_ids.includes(port.source_port_id),
        )
        .flatMap((trace) => trace.connected_source_net_ids)
        .map((id) => nets.find((net) => net.source_net_id === id)!.name)
      const netName = pad.net?.name
      if (!netName)
        throw new Error(`Missing net for ${reference}.${pad.number}`)
      expect(connectedNets).toEqual([
        netName.replace(/^\//, "").replaceAll("/", "_"),
      ])
      return { footprint, reference, component, pad, hole }
    })
  })
  expect(slots).toHaveLength(20)
  expect([...new Set(slots.map((slot) => slot.reference))].sort()).toEqual([
    "EXSW1",
    "EXSW2",
    "rEXSW1",
    "rEXSW2",
  ])
  const preservedSlots = slots.filter(({ hole }) => hole.shape === "pill")
  expect(preservedSlots).toHaveLength(0)

  const sample = slots.find(
    ({ reference, pad }) => reference === "EXSW1" && pad.number === "C",
  )!
  const centerX = sample.footprint.position!.x - sample.component.center.x
  const centerY = sample.footprint.position!.y + sample.component.center.y
  const width = board.width + 4
  const height = board.height + 4
  const minX = -width / 2
  const maxY = height / 2
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
      colorOverrides: { drill: "#e2e8f0", substrate: "#263440" },
    },
  )
  const panel = (
    id: string,
    viewBox: string,
    x: number,
    y: number,
    h: number,
  ) =>
    `<rect x="${x}" y="${y}" width="684" height="${h}" fill="black" stroke="#425563"/>
<svg x="${x}" y="${y}" width="684" height="${h}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet"><use href="#${id}"/></svg>`
  const statusColor =
    preservedSlots.length === slots.length ? "#8fd6a7" : "#ff8585"
  const hole = sample.hole
  const importedDrill =
    hole.shape === "pill"
      ? `${hole.hole_width} × ${hole.hole_height} mm slot · ${hole.ccw_rotation ?? 0}° CCW`
      : hole.shape === "circle"
        ? `${hole.hole_diameter} mm round hole`
        : hole.shape
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">
<rect width="100%" height="100%" fill="#101820"/>
<defs><g id="original">${svgContents(originalSvg)}</g><g id="imported">${svgContents(importedSvg)}</g></defs>
<g font-family="sans-serif" fill="white">
<text x="24" y="38" font-size="26">Corne Keyboard — plated slots inside circular copper pads</text>
<text x="24" y="80" font-size="21">Original KiCad · full board</text>
<text x="732" y="80" font-size="21">Current Circuit JSON import · full board</text>
<text x="24" y="110" font-size="18" fill="#8fd6a7">${slots.length} plated slots · EXSW1, EXSW2, rEXSW1, rEXSW2</text>
<text x="732" y="110" font-size="18" fill="${statusColor}">${preservedSlots.length} slots preserved · ${slots.length - preservedSlots.length} slots lost</text>
<text x="24" y="477" font-size="21">EXSW1 pads B / C / A · original close-up</text>
<text x="732" y="477" font-size="21">EXSW1 pads B / C / A · imported close-up</text>
<text x="24" y="507" font-size="18" fill="#8fd6a7">1 × 0.5 mm slots · 0° CCW · 1.2 mm circular copper</text>
<text x="732" y="507" font-size="18" fill="${statusColor}">${importedDrill} · 1.2 mm circular copper</text>
<text x="24" y="882" font-size="16">All 20 pad centers, pad numbers, net assignments and through-hole copper layers remain unchanged.</text>
</g>
${panel("original", `${centerX + minX} ${centerY - maxY} ${width} ${height}`, 24, 128, 300)}
${panel("imported", `0 0 ${width} ${height}`, 732, 128, 300)}
${panel("original", `${sample.hole.x + centerX - 4} ${centerY - sample.hole.y - 2} 8 4`, 24, 525, 330)}
${panel("imported", `${sample.hole.x - minX - 4} ${maxY - sample.hole.y - 2} 8 4`, 732, 525, 330)}
</svg>`
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
}, 30_000)
