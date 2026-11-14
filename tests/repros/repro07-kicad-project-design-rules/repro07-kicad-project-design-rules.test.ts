import { expect, test } from "bun:test"
import "bun-match-svg"
import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { KicadToCircuitJsonConverter } from "../../../lib"

// Nine DDR3 balls of U1 (H616 SoC, 0.65 mm pitch BGA) cut from the open
// hardware Kononenko-K/Allwinner_H616_Devboard (CERN-OHL-P-2.0), with the
// design rules and net classes of its KiCad project file.
const fixtureFileNames = [
  "h616-ddr-data-corner.kicad_pcb",
  "h616-ddr-data-corner.kicad_pro",
]

interface DesignRules {
  boardRules: Record<string, number>
  traceWidthByNetName: Record<string, number>
}

// Board Setup > Constraints: a zero rule means "no minimum", so the project's
// min_clearance, min_track_width and min_copper_edge_clearance import nothing.
// Net classes: /DRAM/DQ[0-7], /DRAM/DQ[8-9] and /DRAM/SDQM* route at
// 0.0975 mm. Every other net is in the 0.1 mm Default class.
const expectedDesignRules: DesignRules = {
  boardRules: {
    min_via_pad_diameter: 0.35,
    min_via_hole_diameter: 0.15,
    min_via_hole_edge_to_via_hole_edge_clearance: 0.25,
    min_plated_hole_drill_edge_to_drill_edge_clearance: 0.25,
    min_trace_to_hole_edge_clearance: 0.1,
  },
  traceWidthByNetName: {
    DRAM_DQ2: 0.0975,
    DRAM_DQ5: 0.0975,
    DRAM_DQ6: 0.0975,
    DRAM_DQ8: 0.0975,
    DRAM_SDQ23: 0.1,
    DRAM_SDQM1: 0.0975,
    GND: 0.1,
  },
}

async function importFixture() {
  const converter = new KicadToCircuitJsonConverter()
  for (const fileName of fixtureFileNames) {
    const content = await Bun.file(
      new URL(`./${fileName}`, import.meta.url),
    ).text()
    converter.addFile(fileName, content)
  }
  converter.runUntilFinished()
  const imported = converter.getOutput()

  return { imported, importedDesignRules: getDesignRules(imported) }
}

function getDesignRules(circuitJson: CircuitJson): DesignRules {
  const boardRules: Record<string, number> = {}
  const traceWidthByNetName: Record<string, number> = {}
  for (const element of circuitJson) {
    if (element.type === "pcb_board") {
      for (const [field, minimum] of Object.entries(element)) {
        if (!field.startsWith("min_")) continue
        if (typeof minimum === "number") boardRules[field] = minimum
      }
    }
    if (element.type === "source_net" && element.trace_width !== undefined) {
      traceWidthByNetName[element.name] = element.trace_width
    }
  }

  return { boardRules, traceWidthByNetName }
}

// Draws the rules to scale beside the balls: one trace per net at its
// source_net.trace_width, and one via at the board's minimum via size.
function getDesignRuleLegend(designRules: DesignRules): CircuitJson {
  const legend: CircuitJson = []
  const netNames = Object.keys(designRules.traceWidthByNetName).sort()
  for (const [netIndex, netName] of netNames.entries()) {
    const width = designRules.traceWidthByNetName[netName]!
    const y = 1.05 - netIndex * 0.3
    legend.push(
      {
        type: "pcb_trace",
        pcb_trace_id: `legend_trace_${netIndex}`,
        route: [
          { route_type: "wire", x: 1.6, y, width, layer: "top" },
          { route_type: "wire", x: 2.3, y, width, layer: "top" },
        ],
      },
      {
        type: "pcb_silkscreen_text",
        pcb_silkscreen_text_id: `legend_text_${netIndex}`,
        pcb_component_id: "legend",
        font: "tscircuit2024",
        font_size: 0.16,
        text: `${netName} ${width}mm`,
        layer: "top",
        anchor_position: { x: 2.45, y },
        anchor_alignment: "center_left",
      },
    )
  }

  const viaPadDiameter = designRules.boardRules.min_via_pad_diameter
  const viaHoleDiameter = designRules.boardRules.min_via_hole_diameter
  if (viaPadDiameter && viaHoleDiameter) {
    legend.push(
      {
        type: "pcb_via",
        pcb_via_id: "legend_via",
        x: 1.95,
        y: -1.05,
        outer_diameter: viaPadDiameter,
        hole_diameter: viaHoleDiameter,
        layers: ["top", "bottom"],
      },
      {
        type: "pcb_silkscreen_text",
        pcb_silkscreen_text_id: "legend_text_via",
        pcb_component_id: "legend",
        font: "tscircuit2024",
        font_size: 0.16,
        text: `min via ${viaPadDiameter}/${viaHoleDiameter}mm`,
        layer: "top",
        anchor_position: { x: 2.45, y: -1.05 },
        anchor_alignment: "center_left",
      },
    )
  }

  return legend
}

function summarizeDesignRules(designRules: DesignRules) {
  const netWidthCount = Object.keys(designRules.traceWidthByNetName).length
  const boardRuleCount = Object.keys(designRules.boardRules).length
  return `${netWidthCount} net trace widths, ${boardRuleCount} board rules`
}

test("repro07: snapshots KiCad project design rules", async () => {
  const { imported, importedDesignRules } = await importFixture()

  const options = {
    width: 480,
    height: 288,
    includeVersion: false,
    layer: "top" as const,
    viewport: { minX: -1.5, maxX: 4.5, minY: -1.8, maxY: 1.8 },
  }
  const expectedLegend = getDesignRuleLegend(expectedDesignRules)
  const importedLegend = getDesignRuleLegend(importedDesignRules)
  const snapshot = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="360" viewBox="0 0 960 360">
  <rect width="100%" height="100%" fill="#101820"/>
  <g fill="white" font-family="sans-serif" font-size="19">
    <text x="16" y="27">Expected: ${summarizeDesignRules(expectedDesignRules)}</text>
    <text x="496" y="27">Imported: ${summarizeDesignRules(importedDesignRules)}</text>
    <text x="16" y="53" font-size="15">Legend, to scale: source_net.trace_width per net and the pcb_board minimum via</text>
  </g>
  <g transform="translate(0 72)">${convertCircuitJsonToPcbSvg([...imported, ...expectedLegend], options)}</g>
  <g transform="translate(480 72)">${convertCircuitJsonToPcbSvg([...imported, ...importedLegend], options)}</g>
</svg>`
  await expect(snapshot).toMatchSvgSnapshot(import.meta.path, "design-rules")
})

// This expected failure must become a normal test in the stacked fix.
test.failing("repro07: imports KiCad project design rules", async () => {
  const { importedDesignRules } = await importFixture()
  expect(importedDesignRules).toEqual(expectedDesignRules)
})
