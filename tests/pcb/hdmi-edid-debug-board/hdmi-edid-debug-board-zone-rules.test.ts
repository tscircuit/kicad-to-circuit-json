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

test("repro4948: HDMI EDID board retains copper polygons and reports unsupported zone fill rules", async () => {
  const filename = "tests/assets/hdmi-edid-debug-board.kicad_pcb"
  const content = readFileSync(filename, "utf8")
  const source = parseKicadPcb(content)
  expect(
    source.zones.map((zone) => ({
      net: zone.netName,
      clearance: zone.connectPads?.clearance,
      thermalGap: zone.fill?.thermalGap,
      thermalBridge: zone.fill?.thermalBridgeWidth,
      minimumThickness: zone.minThickness,
      priority: zone.priority,
    })),
  ).toEqual([
    {
      net: "GND",
      clearance: 0.15,
      thermalGap: 0.5,
      thermalBridge: 0.5,
      minimumThickness: 0.15,
      priority: undefined,
    },
    {
      net: "+5V",
      clearance: 0.3,
      thermalGap: 0.5,
      thermalBridge: 0.5,
      minimumThickness: 0.15,
      priority: 2,
    },
    {
      net: "+3V3",
      clearance: 0.15,
      thermalGap: 0.5,
      thermalBridge: 0.5,
      minimumThickness: 0.15,
      priority: 1,
    },
  ])
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("hdmi-edid-debug-board.kicad_pcb", content)
  converter.runUntilFinished()
  const circuitJson = converter.getOutput()
  const polygons = source.zones.flatMap((zone) => zone.filledPolygons)
  const pours = circuitJson.filter((item) => item.type === "pcb_copper_pour")
  expect(polygons).toHaveLength(10)
  expect(pours).toHaveLength(polygons.length)
  const board = circuitJson.find((item) => item.type === "pcb_board")
  const component = circuitJson.find((item) => item.type === "pcb_component")
  const footprint = source.footprints[0]
  if (!board?.width || !board.height || !component || !footprint?.position) {
    throw new Error("Missing board bounds or first footprint")
  }
  const centerX = footprint.position.x - component.center.x
  const centerY = footprint.position.y + component.center.y
  for (const [index, polygon] of polygons.entries()) {
    const pour = pours[index]!
    expect(pour.shape).toBe("polygon")
    if (pour.shape !== "polygon") throw new Error("Expected filled polygon")
    const points = polygon.pts!.points.filter((point) => point instanceof Xy)
    expect(pour.points).toHaveLength(points.length)
    for (const [pointIndex, point] of points.entries()) {
      expect(pour.points[pointIndex]!.x).toBeCloseTo(point.x - centerX, 6)
      expect(pour.points[pointIndex]!.y).toBeCloseTo(centerY - point.y, 6)
    }
  }
  const warnings = converter
    .getWarnings()
    .filter((message) => message.includes("fill rules"))
  expect(warnings).toHaveLength(source.zones.length)
  for (const zone of source.zones) {
    const warning = warnings.find((message) =>
      message.includes(zone.uuid!.value),
    )
    expect(warning).toContain(`clearance_mm=${zone.connectPads!.clearance}`)
    expect(warning).toContain("connect_pads=thermal_relief")
    expect(warning).toContain("minimum_thickness_mm=0.15")
    expect(warning).toContain("thermal_gap_mm=0.5")
    expect(warning).toContain("thermal_bridge_width_mm=0.5")
    if (zone.priority !== undefined)
      expect(warning).toContain(`priority=${zone.priority}`)
    for (const layer of [
      ...(zone.layer?.names ?? []),
      ...(zone.layers?.names ?? []),
    ])
      expect(warning).toContain(layer)
    expect(warning).toContain("Recreate these rules before refilling copper")
  }

  const width = board.width + 6
  const height = board.height + 6
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
    // Match the native snapshot's F.Cu/B.Cu view; all inner-layer polygons
    // are checked numerically above.
    circuitJson.filter(
      (item) =>
        !item.type.startsWith("pcb_fabrication") &&
        (item.type !== "pcb_copper_pour" ||
          item.layer === "top" ||
          item.layer === "bottom"),
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
  const rows = source.zones
    .map((zone, index) => {
      const reported = warnings.some((message) =>
        message.includes(zone.uuid!.value),
      )
      const y = 610 + index * 80
      const layers = [
        ...(zone.layer?.names ?? []),
        ...(zone.layers?.names ?? []),
      ].join(", ")
      return `<text x="24" y="${y}" font-size="18">${zone.netName} · ${layers} · ${zone.uuid!.value}</text>
<text x="24" y="${y + 28}" font-size="16" fill="#b8c7d4">Clearance ${zone.connectPads!.clearance} mm · min. thickness ${zone.minThickness} mm · thermal gap / bridge 0.5 / 0.5 mm · priority ${zone.priority ?? "default"}</text>
<text x="1110" y="${y}" font-size="18" fill="${reported ? "#fbbf24" : "#ff8585"}">${reported ? "Loss reported" : "Rules lost silently"}</text>`
    })
    .join("")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="875" viewBox="0 0 1440 875">
<rect width="1440" height="875" fill="#101820"/>
<g font-family="sans-serif" fill="white">
<text x="24" y="38" font-size="26">HDMI EDID Debug Board — editable copper-fill rules</text>
<text x="24" y="80" font-size="21">Original KiCad · full board · outer copper</text>
<text x="732" y="80" font-size="21">Circuit JSON import · full board · outer copper</text>
<text x="24" y="110" font-size="18" fill="#8fd6a7">3 authored zones · 10 filled copper polygons</text>
<text x="732" y="110" font-size="18" fill="${warnings.length ? "#fbbf24" : "#ff8585"}">10 polygons retained · ${warnings.length} rule losses reported · ${3 - warnings.length} silent</text>
<svg x="24" y="130" width="684" height="410" viewBox="${centerX + minX} ${centerY - maxY} ${width} ${height}" preserveAspectRatio="xMidYMid meet">${svgContents(originalSvg)}</svg>
<svg x="732" y="130" width="684" height="410" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">${svgContents(importedSvg)}</svg>
${rows}
<text x="24" y="850" font-size="17">Static copper polygons do not retain editable KiCad fill rules. Recreate those rules before refilling copper.</text>
</g></svg>`
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
}, 30_000)
