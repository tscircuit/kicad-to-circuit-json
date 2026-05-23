import { test, expect } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../../lib"

test("kicad-to-circuit-json: kicad-laser-prefab PCB", async () => {
  // Load the KiCad PCB file
  const kicadPcbPath = "tests/assets/kicad_laser_prefab_example.kicad_pcb"
  const kicadPcbContent = readFileSync(kicadPcbPath, "utf-8")

  // Convert to Circuit JSON
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("kicad-laser-prefab.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()

  // Verify we got some output
  expect(circuitJson).toBeDefined()
  expect(circuitJson.length).toBeGreaterThan(0)

  // Write Circuit JSON to file for inspection
  writeFileSync(
    "tests/pcb/__snapshots__/kicad_laser_prefab_example-circuit-json.json",
    JSON.stringify(circuitJson, null, 2),
  )

  // Compare the generated Circuit JSON SVG against the tracked SVG snapshot.
  const { convertCircuitJsonToPcbSvg } = await import("circuit-to-svg")
  const circuitJsonSvg = convertCircuitJsonToPcbSvg(circuitJson as any, {
    showCourtyards: true,
  })
  const svgSnapshotPath =
    "tests/pcb/__snapshots__/kicad_laser_prefab_example-circuit-json.svg"
  const shouldUpdateSnapshot =
    process.argv.includes("--update-snapshots") ||
    process.argv.includes("-u") ||
    Boolean(process.env["BUN_UPDATE_SNAPSHOTS"])

  if (!existsSync(svgSnapshotPath) || shouldUpdateSnapshot) {
    writeFileSync(svgSnapshotPath, circuitJsonSvg)
  }
  expect(circuitJsonSvg).toBe(readFileSync(svgSnapshotPath, "utf-8"))
})
