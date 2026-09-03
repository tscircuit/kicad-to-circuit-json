import { expect, test } from "bun:test"
import type {
  PcbBoard,
  PcbComponent,
  PcbPlatedHole,
  PcbSmtPad,
} from "circuit-json"
import { existsSync, readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../lib"
import { stackCircuitJsonKicadPngs } from "./fixtures/stackCircuitJsonKicadPngs"
import { takeCircuitJsonSnapshot } from "./fixtures/take-circuit-json-snapshot"
import { takeKicadSnapshot } from "./fixtures/take-kicad-snapshot"
import "./fixtures/png-matcher"

test("kicad-to-circuit-json: pic_programmer PCB", async () => {
  // Load the KiCad PCB file
  const kicadPcbPath =
    "kicad-demos/demos/pic_programmer/pic_programmer.kicad_pcb"

  if (!existsSync(kicadPcbPath)) {
    console.warn(
      `Skipping pic_programmer PCB test, fixture missing: ${kicadPcbPath}`,
    )
    return
  }

  const kicadPcbContent = readFileSync(kicadPcbPath, "utf-8")

  // Convert to Circuit JSON
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("pic_programmer.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  const warnings = converter.getWarnings()
  const stats = converter.getStats()

  // Log diagnostics
  console.log("Conversion stats:", stats)
  if (warnings.length > 0) {
    console.log("Warnings:", warnings)
  }

  // Debug: Log sample of output
  console.log("\nCircuit JSON element count:", circuitJson.length)
  console.log(
    "\nElement types:",
    [...new Set(circuitJson.map((el: any) => el.type))].sort(),
  )

  // Check a few components
  const components = circuitJson.filter(
    (el): el is PcbComponent => el.type === "pcb_component",
  )
  console.log("\nSample components:")
  for (const c of components.slice(0, 3)) {
    console.log(
      `  - ${c.pcb_component_id}: center=(${c.center?.x?.toFixed(2)}, ${c.center?.y?.toFixed(2)}), layer=${c.layer}`,
    )
  }

  // Check pads
  const pads = circuitJson.filter(
    (el): el is PcbSmtPad | PcbPlatedHole =>
      el.type === "pcb_smtpad" || el.type === "pcb_plated_hole",
  )
  console.log("\nSample pads:")
  for (const p of pads.slice(0, 3)) {
    const position = "x" in p && "y" in p ? p : undefined
    console.log(
      `  - ${p.type}: x=${position?.x ?? "N/A"}, y=${position?.y ?? "N/A"}`,
    )
  }

  // Check coordinate ranges
  const allX = pads.map((p: any) => p.x).filter((x: number) => x !== undefined)
  const allY = pads.map((p: any) => p.y).filter((y: number) => y !== undefined)
  console.log("\nCoordinate ranges:")
  console.log(
    `  X: ${Math.min(...allX).toFixed(2)} to ${Math.max(...allX).toFixed(2)}`,
  )
  console.log(
    `  Y: ${Math.min(...allY).toFixed(2)} to ${Math.max(...allY).toFixed(2)}`,
  )

  // Check board
  const boards = circuitJson.filter(
    (el): el is PcbBoard => el.type === "pcb_board",
  )
  console.log("\nBoards:", boards.length)
  if (boards[0]) {
    const board = boards[0]
    console.log(`  Outline points: ${board.outline?.length || 0}`)
    console.log(`  Board size: ${board.width} x ${board.height}`)
  }

  // Verify we got some output
  expect(circuitJson).toBeDefined()
  expect(circuitJson.length).toBeGreaterThan(0)

  // Write Circuit JSON to file for inspection
  const fs = await import("node:fs/promises")
  await fs.writeFile(
    "tests/__snapshots__/pic_programmer-circuit-json.json",
    JSON.stringify(circuitJson, null, 2),
  )

  // Take snapshots
  const kicadSnapshot = await takeKicadSnapshot({
    kicadFilePath: kicadPcbPath,
    kicadFileType: "pcb",
    pcbSnapshotBounds: "circuit-json",
  })

  const kicadPng = Object.values(kicadSnapshot.generatedFileContent)[0]!

  const circuitJsonPng = await takeCircuitJsonSnapshot({
    circuitJson: circuitJson as any,
    outputType: "pcb",
  })

  // Also export the circuit JSON as SVG for inspection
  const { convertCircuitJsonToPcbSvg } = await import("circuit-to-svg")
  const circuitJsonSvg = convertCircuitJsonToPcbSvg(circuitJson as any, {
    showCourtyards: true,
  })
  await fs.writeFile(
    "tests/__snapshots__/pic_programmer-circuit-json.svg",
    circuitJsonSvg,
  )

  // Stack them vertically with labels (Circuit JSON on top, KiCad on bottom)
  const stackedPng = await stackCircuitJsonKicadPngs(circuitJsonPng, kicadPng)

  // Save as snapshot for visual comparison
  await expect(stackedPng).toMatchPngSnapshot(
    import.meta.path,
    "pic_programmer-pcb",
  )

  const boardBoundsKicadSnapshot = await takeKicadSnapshot({
    kicadFilePath: kicadPcbPath,
    kicadFileType: "pcb",
  })
  const boardBoundsKicadPng = Object.values(
    boardBoundsKicadSnapshot.generatedFileContent,
  )[0]!
  const sideBySidePng = await stackCircuitJsonKicadPngs(
    circuitJsonPng,
    boardBoundsKicadPng,
    "horizontal",
  )
  await expect(sideBySidePng).toMatchPngSnapshot(
    import.meta.path,
    "pic_programmer-board-text-parity",
  )
}, 20_000)
