import { expect, test } from "bun:test"
import "bun-match-svg"
import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { KicadToCircuitJsonConverter } from "../../../lib"

// The SDQS0 strobe pair of U1 (H616 SoC, 0.65 mm pitch BGA), four neighbouring
// balls and their top-layer tracks, cut from the open hardware
// Kononenko-K/Allwinner_H616_Devboard (CERN-OHL-P-2.0), with the net classes
// of its KiCad project file.
const fixtureFileNames = [
  "h616-ddr-strobe-pair.kicad_pcb",
  "h616-ddr-strobe-pair.kicad_pro",
]

// /DRAM/SDQS0P and /DRAM/SDQS0N are in the DDR3_DIFF class: 0.25 mm track
// width, 0.093 mm differential pair width. KiCad pairs the two nets by their
// P and N suffixes and routes a paired net at the differential pair width,
// which is the width of their tracks on the board.
const expectedTraceWidthByNetName: Record<string, number> = {
  DRAM_DQ9: 0.0975,
  DRAM_DQ11: 0.0975,
  DRAM_DQ12: 0.0975,
  DRAM_SDQS0N: 0.093,
  DRAM_SDQS0P: 0.093,
  GND: 0.1,
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

  return { imported, importedTraceWidthByNetName: getTraceWidths(imported) }
}

function getTraceWidths(circuitJson: CircuitJson) {
  const traceWidthByNetName: Record<string, number> = {}
  for (const element of circuitJson) {
    if (element.type !== "source_net") continue
    if (element.trace_width === undefined) continue
    traceWidthByNetName[element.name] = element.trace_width
  }

  return traceWidthByNetName
}

// Draws one trace per net at its source_net.trace_width, to scale beside the
// balls and the tracks KiCad routed.
function getTraceWidthLegend(
  traceWidthByNetName: Record<string, number>,
): CircuitJson {
  const legend: CircuitJson = []
  const netNames = Object.keys(traceWidthByNetName).sort()
  for (const [netIndex, netName] of netNames.entries()) {
    const width = traceWidthByNetName[netName]!
    const y = 0.9 - netIndex * 0.36
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

  return legend
}

function summarizeStrobePair(traceWidthByNetName: Record<string, number>) {
  const widths = ["DRAM_SDQS0P", "DRAM_SDQS0N"].map(
    (netName) => traceWidthByNetName[netName],
  )
  return `SDQS0P / SDQS0N at ${widths.join(" / ")} mm`
}

test("repro08: snapshots KiCad differential pair trace widths", async () => {
  const { imported, importedTraceWidthByNetName } = await importFixture()

  const options = {
    width: 480,
    height: 288,
    includeVersion: false,
    layer: "top" as const,
    viewport: { minX: -1.5, maxX: 4.5, minY: -1.8, maxY: 1.8 },
  }
  const expectedLegend = getTraceWidthLegend(expectedTraceWidthByNetName)
  const importedLegend = getTraceWidthLegend(importedTraceWidthByNetName)
  const snapshot = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="360" viewBox="0 0 960 360">
  <rect width="100%" height="100%" fill="#101820"/>
  <g fill="white" font-family="sans-serif" font-size="19">
    <text x="16" y="27">Expected: ${summarizeStrobePair(expectedTraceWidthByNetName)}</text>
    <text x="496" y="27">Imported: ${summarizeStrobePair(importedTraceWidthByNetName)}</text>
    <text x="16" y="53" font-size="15">Legend, to scale: source_net.trace_width per net, beside the tracks KiCad routed (strobe pair: 0.093 mm)</text>
  </g>
  <g transform="translate(0 72)">${convertCircuitJsonToPcbSvg([...imported, ...expectedLegend], options)}</g>
  <g transform="translate(480 72)">${convertCircuitJsonToPcbSvg([...imported, ...importedLegend], options)}</g>
</svg>`
  await expect(snapshot).toMatchSvgSnapshot(
    import.meta.path,
    "differential-pair-width",
  )
})

test("repro08: imports the differential pair width of a KiCad net class", async () => {
  const { importedTraceWidthByNetName } = await importFixture()
  expect(importedTraceWidthByNetName).toEqual(expectedTraceWidthByNetName)
})
