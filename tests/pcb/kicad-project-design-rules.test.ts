import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../../lib"

const boardPath =
  "tests/repros/repro07-kicad-project-design-rules/h616-ddr-data-corner.kicad_pcb"

async function importWithProject(kicadProject: object) {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("board.kicad_pcb", await Bun.file(boardPath).text())
  converter.addFile("board.kicad_pro", JSON.stringify(kicadProject))
  converter.runUntilFinished()

  const boardRules: Record<string, number> = {}
  const traceWidthByNetName: Record<string, number> = {}
  for (const element of converter.getOutput()) {
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

  return { boardRules, traceWidthByNetName, warnings: converter.getWarnings() }
}

test("KiCad project: board constraints set pcb_board minimums", async () => {
  const { boardRules } = await importWithProject({
    board: {
      design_settings: {
        rules: {
          min_clearance: 0.15,
          min_copper_edge_clearance: 0.3,
          min_hole_clearance: 0.25,
          min_hole_to_hole: 0.5,
          min_through_hole_diameter: 0.2,
          min_track_width: 0.12,
          min_via_annular_width: 0.1,
          min_via_diameter: 0.4,
        },
      },
    },
  })

  expect(boardRules).toEqual({
    // Copper of different nets, whatever the items are.
    min_trace_to_pad_edge_clearance: 0.15,
    min_pad_edge_to_pad_edge_clearance: 0.15,
    min_different_net_trace_edge_to_trace_edge_clearance: 0.15,
    min_via_edge_to_pad_edge_clearance: 0.15,
    min_board_edge_clearance: 0.3,
    min_trace_to_hole_edge_clearance: 0.25,
    // Edge to edge of any two drilled holes.
    min_via_hole_edge_to_via_hole_edge_clearance: 0.5,
    min_plated_hole_drill_edge_to_drill_edge_clearance: 0.5,
    min_via_hole_diameter: 0.2,
    min_trace_width: 0.12,
    min_via_pad_diameter: 0.4,
  })
})

test("KiCad project: unset constraints import nothing", async () => {
  const { boardRules } = await importWithProject({
    board: {
      design_settings: {
        // KiCad stores 0 for a constraint that is not set, and -0.01 to take
        // the edge clearance from the outline width as KiCad 5 did.
        rules: { min_clearance: 0, min_copper_edge_clearance: -0.01 },
      },
    },
  })

  expect(boardRules).toEqual({})
})

test("KiCad 6 project: a class sets the width of its nets", async () => {
  const { traceWidthByNetName } = await importWithProject({
    net_settings: {
      meta: { version: 2 },
      classes: [
        { name: "Default", track_width: 0.25, nets: [] },
        { name: "DDR3", track_width: 0.1, nets: ["/DRAM/DQ2", "/DRAM/DQ8"] },
      ],
    },
  })

  expect(traceWidthByNetName).toMatchObject({
    DRAM_DQ2: 0.1,
    DRAM_DQ8: 0.1,
    DRAM_DQ5: 0.25,
    GND: 0.25,
  })
})

test("KiCad 9 project: a class without a width defers", async () => {
  const { traceWidthByNetName } = await importWithProject({
    net_settings: {
      meta: { version: 4 },
      classes: [
        { name: "Default", priority: 2147483647, track_width: 0.2 },
        { name: "DATA", priority: 0 },
        { name: "LOW_BYTE", priority: 1, track_width: 0.1 },
      ],
      netclass_assignments: { "/DRAM/SDQM1": ["LOW_BYTE"] },
      netclass_patterns: [
        { netclass: "DATA", pattern: "/DRAM/DQ*" },
        { netclass: "LOW_BYTE", pattern: "/DRAM/DQ[0-7]" },
      ],
    },
  })

  expect(traceWidthByNetName).toMatchObject({
    // DATA and LOW_BYTE: DATA comes first but sets no width.
    DRAM_DQ2: 0.1,
    // DATA only, so the width comes from the Default class.
    DRAM_DQ8: 0.2,
    DRAM_SDQM1: 0.1,
    GND: 0.2,
  })
})

test("KiCad project: reports an unsupported pattern", async () => {
  const { traceWidthByNetName, warnings } = await importWithProject({
    net_settings: {
      meta: { version: 3 },
      classes: [
        { name: "Default", track_width: 0.2 },
        { name: "DATA", track_width: 0.1 },
      ],
      netclass_patterns: [{ netclass: "DATA", pattern: "(?i)/dram/dq.*" }],
    },
  })

  expect(warnings).toEqual([
    'Net class pattern "(?i)/dram/dq.*" uses unsupported regular expression syntax; only its wildcard reading was applied',
  ])
  expect(traceWidthByNetName.DRAM_DQ2).toBe(0.2)
})
