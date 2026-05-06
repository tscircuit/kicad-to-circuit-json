import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { stackCircuitJsonKicadPngs } from "../../fixtures/stackCircuitJsonKicadPngs"
import { takeCircuitJsonSnapshot } from "../../fixtures/take-circuit-json-snapshot"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"
import "../../fixtures/png-matcher"

test("ESP32-C3 low-power IoT battery monitor PCB", async () => {
  const reproName = "esp32-c3-iot-battery-pcb"
  const reproDir = `tests/repros/${reproName}`
  const kicadPcbPath = `${reproDir}/esp32-c3-iot-battery-pcb.kicad_pcb`
  const kicadPcbContent = readFileSync(kicadPcbPath, "utf-8")

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("source.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()

  const sourceTraces = (circuitJson as any[]).filter(
    (el) => el.type === "source_trace",
  )

  const sourceTraceIds = new Set(
    sourceTraces.map((trace) => trace.source_trace_id).filter(Boolean),
  )
  const pcbTracesWithSourceTrace = (circuitJson as any[]).filter(
    (el) => el.type === "pcb_trace" && sourceTraceIds.has(el.source_trace_id),
  )

  const smtPads = (circuitJson as any[]).filter(
    (el) => el.type === "pcb_smtpad",
  )
  const platedHoles = (circuitJson as any[]).filter(
    (el) => el.type === "pcb_plated_hole",
  )

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

  const fs = await import("node:fs/promises")
  await fs.mkdir(`${reproDir}/__snapshots__`, {
    recursive: true,
  })
  await fs.writeFile(
    `${reproDir}/__snapshots__/${reproName}-circuit-json.json`,
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
    `${reproDir}/__snapshots__/${reproName}-circuit-json.svg`,
    circuitJsonSvg,
  )

  const stackedPng = await stackCircuitJsonKicadPngs(circuitJsonPng, kicadPng)
  await expect(stackedPng).toMatchPngSnapshot(
    import.meta.path,
    `${reproName}-pcb`,
  )
}, 30_000)
