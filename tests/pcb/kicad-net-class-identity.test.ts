import { expect, test } from "bun:test"
import "bun-match-svg"
import { KicadToCircuitJsonConverter } from "../../lib"

const netSettings = {
  meta: { version: 4 },
  classes: [
    { name: "Default", track_width: 0.2, priority: 2147483647 },
    { name: "Power", track_width: 0.8, priority: 1, clearance: 0.3 },
    { name: "Sense", track_width: 0.8, priority: 2 },
    { name: "Inherited", priority: 0 },
    { name: "Unused", track_width: 0.4, via_diameter: 0.7 },
  ],
  netclass_assignments: {
    "/DRAM/DQ2": ["Power"],
    "/DRAM/DQ5": ["Sense"],
    "/DRAM/DQ6": ["Inherited", "Power"],
  },
  netclass_patterns: [{ netclass: "Sense", pattern: "SENSE*" }],
  future_kicad_setting: { preserve: true },
}

async function importClasses() {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "board.kicad_pcb",
    await Bun.file(
      "tests/repros/repro07-kicad-project-design-rules/h616-ddr-data-corner.kicad_pcb",
    ).text(),
  )
  converter.addFile(
    "board.kicad_pro",
    JSON.stringify({ net_settings: netSettings }),
  )
  converter.runUntilFinished()
  // Exercise the JSON boundary without requiring the proposed schema in the repro.
  return JSON.parse(JSON.stringify(converter.getOutput())) as Array<{
    type: string
    name?: string
    trace_width?: number
    metadata?: {
      kicad_project?: { net_settings: typeof netSettings }
      kicad_net?: { name: string; circuit_json_name: string }
    }
  }>
}

test("snapshot imported KiCad metadata alongside native widths", async () => {
  const circuitJson = await importClasses()
  const preserved = circuitJson.find(
    (element) => element.type === "source_project_metadata",
  )?.metadata?.kicad_project?.net_settings
  const rows = circuitJson
    .filter((element) => element.type === "source_net")
    .map(
      (net, index) =>
        `<text x="20" y="${85 + index * 30}">${net.name}: ${net.metadata?.kicad_net?.name ?? "NO IMPORT METADATA"} (${net.trace_width} mm)</text>`,
    )
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="340"><rect width="100%" height="100%" fill="#fff"/><g font-family="monospace" font-size="16" fill="#111"><text x="20" y="30">KiCad project settings remain converter metadata</text><text x="20" y="55">Original definitions retained: ${preserved?.classes.length ?? 0}; routing uses native widths</text>${rows.join("")}</g></svg>`
  await expect(svg).toMatchSvgSnapshot(import.meta.path, "class-identity")
})

test.failing("import preserves raw project settings and original names without native classes", async () => {
  const circuitJson = await importClasses()
  expect(
    circuitJson.find((element) => element.type === "source_project_metadata")
      ?.metadata?.kicad_project?.net_settings,
  ).toEqual(netSettings)
  const net = circuitJson.find(
    (element) => element.type === "source_net" && element.name === "DRAM_DQ6",
  )!
  expect(net.metadata?.kicad_net).toEqual({
    name: "/DRAM/DQ6",
    circuit_json_name: "DRAM_DQ6",
  })
  expect(net.trace_width).toBe(0.8)
  expect(
    circuitJson.some((element) => element.type === "source_net_class"),
  ).toBe(false)
})
