import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { stackCircuitJsonKicadPngs } from "../../fixtures/stackCircuitJsonKicadPngs"
import { takeCircuitJsonSnapshot } from "../../fixtures/take-circuit-json-snapshot"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"
import "../../fixtures/png-matcher"

test("kicad-to-circuit-json repro01: joule-thief PCB", async () => {
  const kicadPcbPath = "tests/repros/repro01-joule-thief/joule-thief.kicad_pcb"
  const kicadPcbContent = readFileSync(kicadPcbPath, "utf-8")

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("joule-thief.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  expect(circuitJson).toBeDefined()
  expect(circuitJson.length).toBeGreaterThan(0)

  const sourceTraces = (circuitJson as any[]).filter(
    (el) => el.type === "source_trace",
  )
  expect(sourceTraces.length).toBeGreaterThan(0)

  const sourceTraceIds = new Set(
    sourceTraces.map((trace) => trace.source_trace_id).filter(Boolean),
  )
  const pcbTracesWithSourceTrace = (circuitJson as any[]).filter(
    (el) => el.type === "pcb_trace" && sourceTraceIds.has(el.source_trace_id),
  )
  expect(pcbTracesWithSourceTrace.length).toBeGreaterThan(0)

  const smtPads = (circuitJson as any[]).filter(
    (el) => el.type === "pcb_smtpad",
  )
  const platedHoles = (circuitJson as any[]).filter(
    (el) => el.type === "pcb_plated_hole",
  )
  expect(smtPads.some((pad) => pad.pcb_port_id)).toBe(true)
  expect(platedHoles.some((hole) => hole.pcb_port_id)).toBe(true)
  expect(
    platedHoles.some(
      (hole) => hole.shape === "rotated_pill_hole_with_rect_pad",
    ),
  ).toBe(true)

  const connectivityMap = getFullConnectivityMapFromCircuitJson(
    circuitJson as any,
  )
  const tracesWithTwoEndpoints = pcbTracesWithSourceTrace
    .map((trace) => {
      const startPortId = trace.route?.find(
        (rp: any) => rp.start_pcb_port_id,
      )?.start_pcb_port_id
      const endPortId = trace.route?.find(
        (rp: any) => rp.end_pcb_port_id,
      )?.end_pcb_port_id

      return {
        traceId: trace.pcb_trace_id,
        startPortId,
        endPortId,
      }
    })
    .filter((trace) => trace.traceId && trace.startPortId && trace.endPortId)

  expect(tracesWithTwoEndpoints.length).toBeGreaterThan(0)

  for (const trace of tracesWithTwoEndpoints.slice(0, 20)) {
    expect(
      connectivityMap.areIdsConnected(trace.traceId, trace.startPortId),
    ).toBe(true)
    expect(
      connectivityMap.areIdsConnected(trace.traceId, trace.endPortId),
    ).toBe(true)
  }

  const fs = await import("node:fs/promises")
  await fs.mkdir("tests/repros/repro01-joule-thief/__snapshots__", {
    recursive: true,
  })
  await fs.writeFile(
    "tests/repros/repro01-joule-thief/__snapshots__/repro01-joule-thief-circuit-json.json",
    JSON.stringify(circuitJson, null, 2),
  )

  const kicadSnapshot = await takeKicadSnapshot({
    kicadFilePath: kicadPcbPath,
    kicadFileType: "pcb",
  })

  const kicadPng = Object.values(kicadSnapshot.generatedFileContent)[0]!
  const circuitJsonPng = await takeCircuitJsonSnapshot({
    circuitJson: circuitJson as any,
    outputType: "pcb",
  })

  const { convertCircuitJsonToPcbSvg } = await import("circuit-to-svg")
  const circuitJsonSvg = convertCircuitJsonToPcbSvg(circuitJson as any, {
    showCourtyards: true,
  })
  await fs.writeFile(
    "tests/repros/repro01-joule-thief/__snapshots__/repro01-joule-thief-circuit-json.svg",
    circuitJsonSvg,
  )

  const stackedPng = await stackCircuitJsonKicadPngs(circuitJsonPng, kicadPng)
  await expect(stackedPng).toMatchPngSnapshot(
    import.meta.path,
    "repro01-joule-thief-pcb",
  )
})
