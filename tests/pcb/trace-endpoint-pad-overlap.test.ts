import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../../lib"

test("pcb trace endpoints inside smd pads connect to owning source ports", () => {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "ov9281-dual-camera-board.kicad_pcb",
    readFileSync(
      "tests/repros/ov9281-dual-camera-board/ov9281-dual-camera-board.kicad_pcb",
      "utf-8",
    ),
  )
  converter.runUntilFinished()

  const circuitJson = converter.getOutput() as any[]
  const sourceComponents = circuitJson.filter(
    (element) => element.type === "source_component",
  )
  const sourcePorts = circuitJson.filter(
    (element) => element.type === "source_port",
  )
  const sourceTraces = circuitJson.filter(
    (element) => element.type === "source_trace",
  )
  const pcbPorts = circuitJson.filter((element) => element.type === "pcb_port")
  const pcbTraces = circuitJson.filter(
    (element) => element.type === "pcb_trace",
  )

  const getSourcePortId = (refdes: string, pinNumber: string) => {
    const component = sourceComponents.find(
      (sourceComponent) => sourceComponent.name === refdes,
    )
    expect(component).toBeDefined()

    const port = sourcePorts.find(
      (sourcePort) =>
        sourcePort.source_component_id === component.source_component_id &&
        String(sourcePort.pin_number) === pinNumber,
    )
    expect(port).toBeDefined()

    return port.source_port_id as string
  }

  const c3Pad1SourcePortId = getSourcePortId("C3", "1")
  const u6Pad1SourcePortId = getSourcePortId("U6", "1")
  const expectedSourcePortIds = [c3Pad1SourcePortId, u6Pad1SourcePortId].sort(
    (a, b) => a.localeCompare(b),
  )

  const c3ToU6SourceTrace = sourceTraces.find((sourceTrace) => {
    const connectedSourcePortIds = [
      ...(sourceTrace.connected_source_port_ids ?? []),
    ].sort((a, b) => a.localeCompare(b))
    return (
      sourceTrace.display_name === "P3V3" &&
      connectedSourcePortIds.join("|") === expectedSourcePortIds.join("|")
    )
  })
  expect(c3ToU6SourceTrace).toBeDefined()

  const c3Pad1PcbPortId = pcbPorts.find(
    (pcbPort) => pcbPort.source_port_id === c3Pad1SourcePortId,
  )?.pcb_port_id
  const u6Pad1PcbPortId = pcbPorts.find(
    (pcbPort) => pcbPort.source_port_id === u6Pad1SourcePortId,
  )?.pcb_port_id
  expect(c3Pad1PcbPortId).toBeDefined()
  expect(u6Pad1PcbPortId).toBeDefined()

  const physicalTrace = pcbTraces.find((pcbTrace) => {
    if (pcbTrace.source_trace_id !== c3ToU6SourceTrace.source_trace_id) {
      return false
    }

    const endpointPortIds = new Set(
      pcbTrace.route.flatMap((routePoint: any) =>
        [routePoint.start_pcb_port_id, routePoint.end_pcb_port_id].filter(
          Boolean,
        ),
      ),
    )

    return (
      endpointPortIds.has(c3Pad1PcbPortId) &&
      endpointPortIds.has(u6Pad1PcbPortId)
    )
  })

  expect(physicalTrace).toBeDefined()
})
