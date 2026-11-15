import { expect, test } from "bun:test"
import "bun-match-svg"
import { readFileSync } from "node:fs"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { parseKicadPcb, Xy } from "kicadts"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"

const svgContents = (svg: string) =>
  svg
    .replace(/^[\s\S]*?<svg\b[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<title>[\s\S]*?<\/title>/, "")

test("repro4948: Corne Keyboard reports all 8 unsupported rule areas on import", async () => {
  const filename = "tests/assets/corne-keyboard/corne-keyboard.kicad_pcb"
  const content = readFileSync(filename, "utf8")
  const source = parseKicadPcb(content)
  const areas = source.zones.filter((zone) => zone.keepout)
  expect(areas).toHaveLength(8)
  expect(
    areas.filter((zone) => zone.keepout?.footprints === "not_allowed"),
  ).toHaveLength(2)
  for (const area of areas) {
    expect(area.layer?.names).toEqual(["F.Cu"])
    expect(area.keepout?.copperpour).toBe("not_allowed")
    expect(area.keepout?.tracks).toBe("allowed")
    expect(area.keepout?.vias).toBe("allowed")
    expect(area.keepout?.pads).toBe("allowed")
    expect(area.tstamp?.value).toBeTruthy()
  }

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("corne-keyboard.kicad_pcb", content)
  converter.runUntilFinished()
  const circuitJson = converter.getOutput()
  expect(
    circuitJson.filter((item) => item.type === "pcb_keepout"),
  ).toHaveLength(0)
  const warnings = converter
    .getWarnings()
    .filter((text) => text.includes("rule area"))
  expect(warnings).toHaveLength(areas.length)
  for (const area of areas) {
    const warning = warnings.find((message) =>
      message.includes(area.tstamp!.value),
    )
    expect(warning).toContain("on F.Cu")
    expect(warning).toContain("tracks=allowed, vias=allowed, pads=allowed")
    expect(warning).toContain("copperpour=not_allowed")
    expect(warning).toContain(`footprints=${area.keepout!.footprints}`)
    expect(warning).toContain(
      "Recreate this rule area before routing or refilling copper",
    )
  }

  const board = circuitJson.find((item) => item.type === "pcb_board")
  const component = circuitJson.find((item) => item.type === "pcb_component")
  const footprint = source.footprints[0]
  if (!board?.width || !board.height || !component || !footprint?.position) {
    throw new Error("Missing board bounds or first footprint")
  }
  const centerX = footprint.position.x - component.center.x
  const centerY = footprint.position.y + component.center.y
  const width = board.width + 4
  const height = board.height + 4
  const minX = -width / 2
  const maxY = height / 2
  const original = await takeKicadSnapshot({
    kicadFilePath: filename,
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
  const outlines = areas
    .map((area, index) => {
      const points = area.polygons[0]!.pts!.points.filter(
        (point) => point instanceof Xy,
      )
      const first = points[0]!
      return `<polygon points="${points.map((point) => `${point.x},${point.y}`).join(" ")}" fill="#fbbf2433" stroke="#fbbf24" stroke-width="0.6"/>
<text x="${first.x}" y="${first.y - 1}" font-size="4" fill="#fbbf24">${index + 1}</text>`
    })
    .join("")
  const rows = areas
    .map((area, index) => {
      const id = area.tstamp!.value
      const reported = warnings.some((message) => message.includes(id))
      const restrictions =
        area.keepout?.footprints === "not_allowed"
          ? "copper pours + footprints"
          : "copper pours"
      const y = 590 + index * 30
      return `<text x="24" y="${y}">${index + 1}. ${id}</text>
<text x="565" y="${y}">F.Cu · blocks ${restrictions}</text>
<text x="1080" y="${y}" fill="${reported ? "#fbbf24" : "#ff8585"}">${reported ? "Warning emitted" : "Lost silently"}</text>`
    })
    .join("")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="920" viewBox="0 0 1440 920">
<rect width="1440" height="920" fill="#101820"/>
<g font-family="sans-serif" fill="white">
<text x="24" y="38" font-size="26">Corne Keyboard — selective rule areas</text>
<text x="24" y="80" font-size="21">Original KiCad · full board</text>
<text x="732" y="80" font-size="21">Current Circuit JSON import · full board</text>
<text x="24" y="110" font-size="18" fill="#fbbf24">8 rule areas · yellow outlines and numbers are source annotations</text>
<text x="732" y="110" font-size="18" fill="${warnings.length ? "#fbbf24" : "#ff8585"}">0 rule areas imported · ${warnings.length} reported · ${areas.length - warnings.length} silent losses</text>
<svg x="24" y="130" width="684" height="370" viewBox="${centerX + minX} ${centerY - maxY} ${width} ${height}" preserveAspectRatio="xMidYMid meet">${svgContents(originalSvg)}${outlines}</svg>
<svg x="732" y="130" width="684" height="370" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">${svgContents(importedSvg)}</svg>
<text x="24" y="540" font-size="21">Source rule-area identity and conversion report</text>
<g font-size="17">${rows}</g>
<text x="24" y="880" font-size="17">Tracks, vias and pads are allowed in all 8 areas. A generic keepout would incorrectly block them.</text>
<text x="24" y="907" font-size="17">Reporting unsupported restrictions does not recreate or enforce them; board geometry is unchanged.</text>
</g></svg>`
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
}, 30_000)
