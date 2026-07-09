import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { KicadFootprintToCircuitJsonConverter } from "../../../lib/KicadFootprintToCircuitJsonConverter"
import { takeCircuitJsonSnapshot } from "../../fixtures/take-circuit-json-snapshot"

test("repro: BQ25180YBGR legacy module footprint snapshots and conversion audit", async () => {
  const sourcePath =
    "tests/repros/bq25180ybgr/BQ25180YBGR.source.kicad_mod"
  const snapshotDir = "tests/repros/bq25180ybgr/__snapshots__"
  const jsonSnapshotPath = `${snapshotDir}/BQ25180YBGR-circuit-json.json`
  const svgSnapshotPath = `${snapshotDir}/BQ25180YBGR-circuit-json.svg`
  const pngSnapshotPath = `${snapshotDir}/BQ25180YBGR-circuit-json.snap.png`

  const converter = new KicadFootprintToCircuitJsonConverter()
  converter.addFile(
    "BQ25180YBGR.kicad_mod",
    readFileSync(sourcePath, "utf8"),
  )
  converter.runUntilFinished()

  const output = converter.getOutput() as any[]
  await mkdir(snapshotDir, { recursive: true })
  await writeFile(jsonSnapshotPath, JSON.stringify(output, null, 2))

  const { convertCircuitJsonToPcbSvg } = await import("circuit-to-svg")
  const svg = convertCircuitJsonToPcbSvg(output as any, {
    showCourtyards: true,
  })
  await writeFile(svgSnapshotPath, svg)

  const png = await takeCircuitJsonSnapshot({
    circuitJson: output as any,
    outputType: "pcb",
  })
  await writeFile(pngSnapshotPath, png)

  expect(converter.getWarnings()).toEqual([])
  expect(converter.getStats()).toMatchObject({ components: 1, pads: 8 })

  const countByType = Object.fromEntries(
    output.reduce((map, element) => {
      map.set(element.type, (map.get(element.type) || 0) + 1)
      return map
    }, new Map<string, number>()),
  )

  expect(countByType).toMatchObject({
    source_component: 1,
    pcb_component: 1,
    pcb_port: 8,
    pcb_smtpad: 8,
    pcb_silkscreen_text: 3,
    pcb_fabrication_note_path: 4,
    pcb_silkscreen_path: 3,
  })

  expect(
    output.some(
      (element) =>
        element.type === "pcb_silkscreen_text" && element.text === "REF**",
    ),
  ).toBe(true)
  expect(
    output.some(
      (element) =>
        element.type === "pcb_silkscreen_text" &&
        element.text === "YBG0008-IPC_A",
    ),
  ).toBe(true)
  expect(
    output.some(
      (element) =>
        element.type === "pcb_silkscreen_text" &&
        element.text === "Designator210",
    ),
  ).toBe(true)

  expect(
    output.some(
      (element) =>
        typeof element.text === "string" &&
        element.text.includes("Copyright 2016 Accelerated Designs"),
    ),
  ).toBe(false)
})
