import { expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { KicadToCircuitJsonConverter } from "../../../lib"

test("kicad-to-circuit-json repro: OV5640 dual camera board PCB", () => {
  const kicadPcbPath =
    "tests/repros/OV5640-dual-camera-board/OV5640-dual-camera-board.kicad_pcb"
  const kicadPcbContent = readFileSync(kicadPcbPath, "utf-8")

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("OV5640-dual-camera-board.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  expect(circuitJson.length).toBeGreaterThan(0)
  expect(circuitJson.some((el: any) => el.type === "pcb_component")).toBe(true)
  expect(circuitJson.some((el: any) => el.type === "pcb_trace")).toBe(true)
  expect(circuitJson.some((el: any) => el.type === "pcb_copper_pour")).toBe(
    true,
  )

  const sourceTraces = circuitJson.filter(
    (el: any) => el.type === "source_trace",
  ) as any[]
  const pcbTraces = circuitJson.filter(
    (el: any) => el.type === "pcb_trace",
  ) as any[]
  const logicalTraceKeys = sourceTraces.map((sourceTrace) =>
    [
      ...(sourceTrace.connected_source_net_ids ?? []),
      ...[...(sourceTrace.connected_source_port_ids ?? [])].sort(),
    ].join("|"),
  )

  expect(new Set(logicalTraceKeys).size).toBe(logicalTraceKeys.length)
  expect(sourceTraces).toHaveLength(190)
  expect(pcbTraces).toHaveLength(272)

  const c18SourceTraces = sourceTraces.filter(
    (sourceTrace) => sourceTrace.display_name === "Net_C18_Pad1",
  )
  expect(c18SourceTraces).toHaveLength(2)
  expect(
    c18SourceTraces
      .map((sourceTrace) =>
        [...sourceTrace.connected_source_port_ids].sort((a, b) =>
          a.localeCompare(b),
        ),
      )
      .sort((a, b) => a.join("|").localeCompare(b.join("|"))),
  ).toEqual([
    ["pcb_component_16_port_1", "pcb_component_5_port_I10"],
    ["pcb_component_5_port_I10", "pcb_component_58_port_1"],
  ])
  expect(
    c18SourceTraces
      .map(
        (sourceTrace) =>
          pcbTraces.filter(
            (pcbTrace) =>
              pcbTrace.source_trace_id === sourceTrace.source_trace_id,
          ).length,
      )
      .sort(),
  ).toEqual([1, 2])

  const circuitJsonSvg = convertCircuitJsonToPcbSvg(circuitJson as any, {
    showCourtyards: true,
  })

  expectSvgSnapshot(
    circuitJsonSvg,
    import.meta.path,
    "OV5640-dual-camera-board-circuit-json",
  )
})

function expectSvgSnapshot(
  svg: string,
  testPath: string,
  snapshotName: string,
) {
  const normalizedSvg = normalizeTransientSvgIds(svg)
  const snapshotDir = path.join(path.dirname(testPath), "__snapshots__")
  const snapshotPath = path.join(snapshotDir, `${snapshotName}.snap.svg`)
  const shouldUpdateSnapshot =
    process.argv.includes("--update-snapshots") ||
    process.argv.includes("-u") ||
    Boolean(process.env["BUN_UPDATE_SNAPSHOTS"])

  if (!existsSync(snapshotDir)) {
    mkdirSync(snapshotDir, { recursive: true })
  }

  if (!existsSync(snapshotPath) || shouldUpdateSnapshot) {
    writeFileSync(snapshotPath, normalizedSvg)
  }

  expect(normalizedSvg).toBe(readFileSync(snapshotPath, "utf-8"))
}

function normalizeTransientSvgIds(svg: string) {
  return svg
    .replaceAll(
      /silkscreen-knockout-mask-(pcb_silkscreen_text_\d+)-\d+/g,
      "silkscreen-knockout-mask-$1",
    )
    .replaceAll(/knockout-mask-(pcb_copper_text_\d+)-\d+/g, "knockout-mask-$1")
}
