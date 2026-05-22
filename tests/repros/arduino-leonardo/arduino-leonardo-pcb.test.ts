import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { takeCircuitJsonSnapshot } from "../../fixtures/take-circuit-json-snapshot"
import "../../fixtures/png-matcher"

test("kicad-to-circuit-json repro: Arduino Leonardo PCB outline excludes Edge.Cuts holes", async () => {
  const kicadPcbPath =
    "tests/repros/arduino-leonardo/arduino-leonardo.kicad_pcb"
  const kicadPcbContent = readFileSync(kicadPcbPath, "utf-8")

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("arduino-leonardo.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  expect(circuitJson).toBeDefined()
  expect(circuitJson.length).toBeGreaterThan(0)

  const pcbBoards = (circuitJson as any[]).filter(
    (el) => el.type === "pcb_board",
  )
  const pcbBoard = pcbBoards[0]!

  expect(pcbBoards).toHaveLength(1)
  expect(pcbBoard.width).toBeCloseTo(68.58, 2)
  expect(pcbBoard.height).toBeCloseTo(53.34, 2)
  expect(pcbBoard.outline).toHaveLength(58)

  const edgeCutHoleCenters = [
    { x: -20.32, y: -24.13 },
    { x: 31.75, y: -19.05 },
    { x: 31.75, y: 8.89 },
    { x: -19.05, y: 24.13 },
  ]

  const outlineIncludesEdgeCutHole = pcbBoard.outline.some(
    (point: { x: number; y: number }) =>
      edgeCutHoleCenters.some(
        (center) => Math.hypot(point.x - center.x, point.y - center.y) < 2.05,
      ),
  )
  expect(outlineIncludesEdgeCutHole).toBe(false)

  const fs = await import("node:fs/promises")
  await fs.mkdir("tests/repros/arduino-leonardo/__snapshots__", {
    recursive: true,
  })
  await fs.writeFile(
    "tests/repros/arduino-leonardo/__snapshots__/arduino-leonardo-circuit-json.json",
    JSON.stringify(circuitJson, null, 2),
  )

  const circuitJsonPng = await takeCircuitJsonSnapshot({
    circuitJson: circuitJson as any,
    outputType: "pcb",
  })

  const { convertCircuitJsonToPcbSvg } = await import("circuit-to-svg")
  const circuitJsonSvg = convertCircuitJsonToPcbSvg(circuitJson as any, {
    showCourtyards: true,
  })
  await fs.writeFile(
    "tests/repros/arduino-leonardo/__snapshots__/arduino-leonardo-circuit-json.svg",
    circuitJsonSvg,
  )

  await expect(circuitJsonPng).toMatchPngSnapshot(
    import.meta.path,
    "arduino-leonardo-pcb",
  )
}, 20_000)
