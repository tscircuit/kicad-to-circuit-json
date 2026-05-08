import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../../lib"

function convertPcb(path: string) {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(path.split("/").pop()!, readFileSync(path, "utf-8"))
  converter.runUntilFinished()
  return converter.getOutput() as any[]
}

test("pcb source ports use local numeric pad aliases", () => {
  const circuitJson = convertPcb(
    "tests/repros/repro01-joule-thief/joule-thief.kicad_pcb",
  )
  const sourceComponents = circuitJson.filter(
    (element) => element.type === "source_component",
  )
  const sourcePorts = circuitJson.filter(
    (element) => element.type === "source_port",
  )
  const sourceTraces = circuitJson.filter(
    (element) => element.type === "source_trace",
  )
  const pcbTraces = circuitJson.filter(
    (element) => element.type === "pcb_trace",
  )

  const u3 = sourceComponents.find((component) => component.name === "U3")
  expect(u3).toBeDefined()

  const u3Pin11 = sourcePorts.find(
    (port) =>
      port.source_component_id === u3.source_component_id &&
      port.pin_number === 11,
  )
  expect(u3Pin11).toBeDefined()
  expect(u3Pin11.name).toBe("pin11")

  for (const port of sourcePorts) {
    const component = sourceComponents.find(
      (sourceComponent) =>
        sourceComponent.source_component_id === port.source_component_id,
    )
    expect(component).toBeDefined()
    expect(port.name.startsWith(`${component.name}.`)).toBe(false)
  }

  const sourcePortIds = new Set(
    sourcePorts.map((port) => port.source_port_id).filter(Boolean),
  )
  for (const sourceTrace of sourceTraces) {
    for (const sourcePortId of sourceTrace.connected_source_port_ids ?? []) {
      expect(sourcePortIds.has(sourcePortId)).toBe(true)
    }
  }

  const sourceTraceIds = new Set(
    sourceTraces.map((trace) => trace.source_trace_id).filter(Boolean),
  )
  for (const pcbTrace of pcbTraces.filter((trace) => trace.source_trace_id)) {
    expect(sourceTraceIds.has(pcbTrace.source_trace_id)).toBe(true)
  }
})

test("pcb source ports preserve nonnumeric pad names as local aliases", () => {
  const circuitJson = convertPcb(
    "tests/assets/corne-keyboard/corne-keyboard.kicad_pcb",
  )
  const sourceComponents = circuitJson.filter(
    (element) => element.type === "source_component",
  )
  const sourcePorts = circuitJson.filter(
    (element) => element.type === "source_port",
  )

  const j2 = sourceComponents.find((component) => component.name === "J2")
  expect(j2).toBeDefined()

  const j2R = sourcePorts.find(
    (port) =>
      port.source_component_id === j2.source_component_id &&
      port.pin_number === "R",
  )
  expect(j2R).toBeDefined()
  expect(j2R.name).toBe("R")
})
