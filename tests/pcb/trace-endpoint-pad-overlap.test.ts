import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../../lib"

const ov9281BoardPath =
  "tests/repros/ov9281-dual-camera-board/ov9281-dual-camera-board.kicad_pcb"

function convertOv9281Board() {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "ov9281-dual-camera-board.kicad_pcb",
    readFileSync(ov9281BoardPath, "utf-8"),
  )
  converter.runUntilFinished()
  return converter.getOutput() as any[]
}

function getSourceAndPcbPortIds(
  circuitJson: any[],
  refdes: string,
  pinNumber: string,
) {
  const sourceComponents = circuitJson.filter(
    (element) => element.type === "source_component",
  )
  const sourcePorts = circuitJson.filter(
    (element) => element.type === "source_port",
  )
  const pcbPorts = circuitJson.filter((element) => element.type === "pcb_port")

  const component = sourceComponents.find(
    (sourceComponent) => sourceComponent.name === refdes,
  )
  expect(component).toBeDefined()

  const sourcePort = sourcePorts.find(
    (port) =>
      port.source_component_id === component.source_component_id &&
      String(port.pin_number) === pinNumber,
  )
  expect(sourcePort).toBeDefined()

  const pcbPort = pcbPorts.find(
    (port) => port.source_port_id === sourcePort.source_port_id,
  )
  expect(pcbPort).toBeDefined()

  return {
    sourcePortId: sourcePort.source_port_id as string,
    pcbPortId: pcbPort.pcb_port_id as string,
    x: pcbPort.x as number,
    y: pcbPort.y as number,
  }
}

test("pcb trace endpoints inside smd pads connect to owning source ports", () => {
  const circuitJson = convertOv9281Board()
  const sourceTraces = circuitJson.filter(
    (element) => element.type === "source_trace",
  )
  const pcbTraces = circuitJson.filter(
    (element) => element.type === "pcb_trace",
  )

  const c3Pad1 = getSourceAndPcbPortIds(circuitJson, "C3", "1")
  const u6Pad1 = getSourceAndPcbPortIds(circuitJson, "U6", "1")

  const c3ToU6SourceTrace = sourceTraces.find((sourceTrace) => {
    const connectedSourcePortIds = new Set(
      sourceTrace.connected_source_port_ids ?? [],
    )
    return (
      sourceTrace.display_name === "P3V3" &&
      connectedSourcePortIds.has(c3Pad1.sourcePortId) &&
      connectedSourcePortIds.has(u6Pad1.sourcePortId)
    )
  })
  expect(c3ToU6SourceTrace).toBeDefined()

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
      endpointPortIds.has(c3Pad1.pcbPortId) &&
      endpointPortIds.has(u6Pad1.pcbPortId)
    )
  })

  expect(physicalTrace).toBeDefined()
})
