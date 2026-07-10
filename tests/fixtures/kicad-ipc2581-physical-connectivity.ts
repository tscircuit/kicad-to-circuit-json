import { expect } from "bun:test"
import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

interface Ipc2581Primitive {
  shape: "circle" | "oval" | "rect"
  width: number
  height: number
}

interface Ipc2581Pad {
  componentRef: string
  pin: string
  net: string
  layer: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  shape: Ipc2581Primitive["shape"]
}

interface Ipc2581Line {
  net: string
  layer: string
  start: { x: number; y: number }
  end: { x: number; y: number }
}

interface CircuitPort {
  nodeKey: string
  pcbPortId: string
  x: number
  y: number
}

interface EndpointExpectation {
  nodeKey: string
  net: string
  layer: string
  point: { x: number; y: number }
  pcbPortId: string
}

interface CircuitTraceEndpoint {
  point: { x: number; y: number }
  layer: string
  portIds: Set<string>
  pcbTraceId: string
}

interface PointOffset {
  x: number
  y: number
}

export function expectCircuitJsonTraceEndpointsMatchKicadIpc2581(params: {
  circuitJson: any[]
  kicadPcbPath: string
}) {
  const { circuitJson, kicadPcbPath } = params
  const ipc2581Text = exportKicadIpc2581(kicadPcbPath)
  const ipc2581 = parseIpc2581PhysicalConnectivity(ipc2581Text)
  const circuitPorts = getCircuitPorts(circuitJson)
  const offset = getCircuitToIpcOffset(ipc2581.pads, circuitPorts)
  const expectations = getEndpointExpectations({
    ipcPads: ipc2581.pads,
    ipcLines: ipc2581.lines,
    circuitPorts,
    offset,
  })
  const actualEndpoints = getCircuitTraceEndpoints(circuitJson)
  const expectationsByPoint = groupEndpointExpectationsByPoint(expectations)

  const mismatches: Array<{
    reason: string
    point: { x: number; y: number }
    expected?: string[]
    actual?: string[]
    pcbTraceId?: string
  }> = []
  let checkedEndpointCount = 0

  for (const actualEndpoint of actualEndpoints) {
    const expectedAtPoint =
      expectationsByPoint.get(
        getEndpointKey(actualEndpoint.point, actualEndpoint.layer),
      ) ?? []
    if (expectedAtPoint.length === 0) continue

    checkedEndpointCount++
    const expectedPortIds = [
      ...new Set(expectedAtPoint.map((endpoint) => endpoint.pcbPortId)),
    ].sort()
    const actualPortIds = [...actualEndpoint.portIds].sort()

    const hasExpectedPort = actualPortIds.some((actualPortId) =>
      expectedPortIds.includes(actualPortId),
    )

    if (!hasExpectedPort) {
      mismatches.push({
        reason: "missing_endpoint_port",
        point: actualEndpoint.point,
        expected: expectedPortIds,
        actual: actualPortIds,
        pcbTraceId: actualEndpoint.pcbTraceId,
      })
    }
  }

  expect({
    checkedEndpointCount,
    mismatches,
  }).toEqual({
    checkedEndpointCount: expect.any(Number),
    mismatches: [],
  })
  expect(checkedEndpointCount).toBeGreaterThan(0)
}

export function getIpc2581PhysicalTraceBetweenPins(params: {
  kicadPcbPath: string
  firstPin: { componentRef: string; pin: string }
  secondPin: { componentRef: string; pin: string }
}) {
  const { kicadPcbPath, firstPin, secondPin } = params
  const ipc2581Text = exportKicadIpc2581(kicadPcbPath)
  const ipc2581 = parseIpc2581PhysicalConnectivity(ipc2581Text)
  const firstPad = ipc2581.pads.find(
    (pad) =>
      pad.componentRef === firstPin.componentRef && pad.pin === firstPin.pin,
  )
  const secondPad = ipc2581.pads.find(
    (pad) =>
      pad.componentRef === secondPin.componentRef && pad.pin === secondPin.pin,
  )

  if (!firstPad) {
    throw new Error(
      `IPC-2581 export did not contain ${firstPin.componentRef}.${firstPin.pin}`,
    )
  }
  if (!secondPad) {
    throw new Error(
      `IPC-2581 export did not contain ${secondPin.componentRef}.${secondPin.pin}`,
    )
  }
  if (firstPad.net !== secondPad.net) {
    throw new Error(
      `IPC-2581 export put ${firstPin.componentRef}.${firstPin.pin} and ${secondPin.componentRef}.${secondPin.pin} on different nets`,
    )
  }

  const unorientedLine = ipc2581.lines.find(
    (candidate) =>
      candidate.net === firstPad.net &&
      candidate.layer === firstPad.layer &&
      firstPad.layer === secondPad.layer &&
      ((isPointInsideIpc2581Pad(candidate.start, firstPad) &&
        isPointInsideIpc2581Pad(candidate.end, secondPad)) ||
        (isPointInsideIpc2581Pad(candidate.start, secondPad) &&
          isPointInsideIpc2581Pad(candidate.end, firstPad))),
  )

  if (!unorientedLine) {
    throw new Error(
      `IPC-2581 export did not contain a ${firstPad.net} route segment physically touching ${firstPin.componentRef}.${firstPin.pin} and ${secondPin.componentRef}.${secondPin.pin}`,
    )
  }

  const line = isPointInsideIpc2581Pad(unorientedLine.start, firstPad)
    ? unorientedLine
    : {
        ...unorientedLine,
        start: unorientedLine.end,
        end: unorientedLine.start,
      }

  return {
    net: firstPad.net,
    firstPad,
    secondPad,
    line,
  }
}

function exportKicadIpc2581(kicadPcbPath: string) {
  const tempDir = mkdtempSync(path.join(tmpdir(), "kicad-ipc2581-"))
  const inputPath = path.join(tempDir, path.basename(kicadPcbPath))
  const outputPath = path.join(
    tempDir,
    `${path.basename(kicadPcbPath, ".kicad_pcb")}.xml`,
  )
  copyFileSync(kicadPcbPath, inputPath)

  execFileSync(
    "kicad-cli",
    ["pcb", "export", "ipc2581", "-o", outputPath, inputPath],
    { stdio: "pipe" },
  )

  if (!existsSync(outputPath)) {
    throw new Error(`KiCad did not write IPC-2581 export to ${outputPath}`)
  }

  return readFileSync(outputPath, "utf-8")
}

function parseIpc2581PhysicalConnectivity(ipc2581Text: string) {
  return {
    pads: getIpc2581Pads(ipc2581Text),
    lines: getIpc2581NetLines(ipc2581Text),
  }
}

function getIpc2581Pads(ipc2581Text: string): Ipc2581Pad[] {
  const primitiveSizes = getIpc2581PrimitiveSizes(ipc2581Text)
  const pads: Ipc2581Pad[] = []

  for (const layerFeature of getIpc2581LayerFeatures(ipc2581Text)) {
    const layer = mapIpc2581LayerToCircuitLayer(layerFeature.layerRef)
    if (!layer) continue

    for (const setMatch of getIpc2581SetMatches(layerFeature.body)) {
      const setAttrs = setMatch.groups?.attrs ?? ""
      const net = getXmlAttribute(setAttrs, "net")
      if (!net) continue

      const setBody = setMatch.groups?.body ?? ""
      for (const padMatch of setBody.matchAll(
        /<[^:\s>]*:?Pad\b(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/[^:\s>]*:?Pad>/g,
      )) {
        const padBody = padMatch.groups?.body ?? ""
        const pinRefAttrs =
          padBody.match(/<[^:\s>]*:?PinRef\b(?<attrs>[^>]*)\/?>/)?.groups
            ?.attrs ?? ""
        const componentRef = getXmlAttribute(pinRefAttrs, "componentRef")
        const pin = getXmlAttribute(pinRefAttrs, "pin")
        if (!componentRef || !pin) continue

        const locationAttrs =
          padBody.match(/<[^:\s>]*:?Location\b(?<attrs>[^>]*)\/?>/)?.groups
            ?.attrs ?? ""
        const primitiveId = getXmlAttribute(
          padBody.match(/<[^:\s>]*:?StandardPrimitiveRef\b(?<attrs>[^>]*)\/?>/)
            ?.groups?.attrs ?? "",
          "id",
        )
        const xformAttrs =
          padBody.match(/<[^:\s>]*:?Xform\b(?<attrs>[^>]*)\/?>/)?.groups
            ?.attrs ?? ""
        const primitive = primitiveId
          ? primitiveSizes.get(primitiveId)
          : undefined
        if (!primitive) continue

        pads.push({
          componentRef,
          pin,
          net,
          layer,
          x: Number(getXmlAttribute(locationAttrs, "x")),
          y: Number(getXmlAttribute(locationAttrs, "y")),
          width: primitive.width,
          height: primitive.height,
          rotation: Number(getXmlAttribute(xformAttrs, "rotation") ?? 0),
          shape: primitive.shape,
        })
      }
    }
  }

  return pads
}

function getIpc2581PrimitiveSizes(ipc2581Text: string) {
  const primitiveSizes = new Map<string, Ipc2581Primitive>()
  for (const entryMatch of ipc2581Text.matchAll(
    /<[^:\s>]*:?EntryStandard\b(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/[^:\s>]*:?EntryStandard>/g,
  )) {
    const id = getXmlAttribute(entryMatch.groups?.attrs ?? "", "id")
    if (!id) continue

    const body = entryMatch.groups?.body ?? ""
    const rectAttrs = getFirstElementAttrs(body, [
      "RectCenter",
      "RectRound",
      "RectCham",
    ])
    if (rectAttrs) {
      primitiveSizes.set(id, {
        shape: "rect",
        width: Number(getXmlAttribute(rectAttrs, "width")),
        height: Number(getXmlAttribute(rectAttrs, "height")),
      })
      continue
    }

    const ovalAttrs = getFirstElementAttrs(body, ["Oval"])
    if (ovalAttrs) {
      primitiveSizes.set(id, {
        shape: "oval",
        width: Number(getXmlAttribute(ovalAttrs, "width")),
        height: Number(getXmlAttribute(ovalAttrs, "height")),
      })
      continue
    }

    const circleAttrs = getFirstElementAttrs(body, ["Circle"])
    const diameter = circleAttrs
      ? getXmlAttribute(circleAttrs, "diameter")
      : undefined
    if (diameter) {
      primitiveSizes.set(id, {
        shape: "circle",
        width: Number(diameter),
        height: Number(diameter),
      })
    }
  }

  return primitiveSizes
}

function getIpc2581NetLines(ipc2581Text: string): Ipc2581Line[] {
  const lines: Ipc2581Line[] = []

  for (const layerFeature of getIpc2581LayerFeatures(ipc2581Text)) {
    const layer = mapIpc2581LayerToCircuitLayer(layerFeature.layerRef)
    if (!layer) continue

    for (const setMatch of getIpc2581SetMatches(layerFeature.body)) {
      const setAttrs = setMatch.groups?.attrs ?? ""
      const net = getXmlAttribute(setAttrs, "net")
      if (!net) continue

      const setBody = setMatch.groups?.body ?? ""
      if (!/<[^:\s>]*:?Features\b/.test(setBody)) continue

      for (const lineMatch of setBody.matchAll(
        /<[^:\s>]*:?Line\b(?<attrs>[^>]*)>/g,
      )) {
        const attrs = lineMatch.groups?.attrs ?? ""
        const startX = getXmlAttribute(attrs, "startX")
        const startY = getXmlAttribute(attrs, "startY")
        const endX = getXmlAttribute(attrs, "endX")
        const endY = getXmlAttribute(attrs, "endY")
        if (!startX || !startY || !endX || !endY) continue

        lines.push({
          net,
          layer,
          start: { x: Number(startX), y: Number(startY) },
          end: { x: Number(endX), y: Number(endY) },
        })
      }
    }
  }

  return lines
}

function getCircuitPorts(circuitJson: any[]) {
  const componentNameById = new Map<string, string>()
  for (const component of circuitJson) {
    if (component.type === "source_component") {
      componentNameById.set(component.source_component_id, component.name)
    }
  }

  const nodeKeyBySourcePortId = new Map<string, string>()
  for (const sourcePort of circuitJson) {
    if (sourcePort.type !== "source_port") continue

    const componentName = componentNameById.get(sourcePort.source_component_id)
    if (!componentName) continue

    nodeKeyBySourcePortId.set(
      sourcePort.source_port_id,
      getNodeKey(componentName, String(sourcePort.pin_number)),
    )
  }

  const portsByNodeKey = new Map<string, CircuitPort[]>()
  for (const pcbPort of circuitJson) {
    if (pcbPort.type !== "pcb_port") continue

    const nodeKey = nodeKeyBySourcePortId.get(pcbPort.source_port_id)
    if (!nodeKey) continue

    const ports = portsByNodeKey.get(nodeKey) ?? []
    ports.push({
      nodeKey,
      pcbPortId: pcbPort.pcb_port_id,
      x: pcbPort.x,
      y: pcbPort.y,
    })
    portsByNodeKey.set(nodeKey, ports)
  }

  return portsByNodeKey
}

function getCircuitToIpcOffset(
  ipcPads: Ipc2581Pad[],
  circuitPorts: Map<string, CircuitPort[]>,
): PointOffset {
  const offsets: PointOffset[] = []
  for (const ipcPad of ipcPads) {
    const candidates = circuitPorts.get(getPadNodeKey(ipcPad)) ?? []
    if (candidates.length !== 1) continue

    offsets.push({
      x: candidates[0]!.x - ipcPad.x,
      y: candidates[0]!.y - ipcPad.y,
    })
  }

  if (offsets.length === 0) {
    throw new Error(
      "Could not align IPC-2581 coordinates to circuit-json ports",
    )
  }

  return {
    x: median(offsets.map((offset) => offset.x)),
    y: median(offsets.map((offset) => offset.y)),
  }
}

function getEndpointExpectations(params: {
  ipcPads: Ipc2581Pad[]
  ipcLines: Ipc2581Line[]
  circuitPorts: Map<string, CircuitPort[]>
  offset: PointOffset
}) {
  const { ipcPads, ipcLines, circuitPorts, offset } = params
  const padsByNetAndLayer = new Map<string, Ipc2581Pad[]>()
  for (const pad of ipcPads) {
    const pads = padsByNetAndLayer.get(getNetLayerKey(pad.net, pad.layer)) ?? []
    pads.push(pad)
    padsByNetAndLayer.set(getNetLayerKey(pad.net, pad.layer), pads)
  }

  const expectationsByKey = new Map<string, EndpointExpectation>()
  for (const line of ipcLines) {
    for (const point of [line.start, line.end]) {
      for (const pad of padsByNetAndLayer.get(
        getNetLayerKey(line.net, line.layer),
      ) ?? []) {
        if (!isPointInsideIpc2581Pad(point, pad)) continue

        const circuitPort = getCircuitPortForIpcPad({
          ipcPad: pad,
          circuitPorts,
          offset,
        })
        if (!circuitPort) continue

        const transformedPoint = transformIpcPoint(point, offset)
        const expectation = {
          nodeKey: getPadNodeKey(pad),
          net: pad.net,
          layer: pad.layer,
          point: transformedPoint,
          pcbPortId: circuitPort.pcbPortId,
        }
        expectationsByKey.set(
          `${getPointKey(transformedPoint)}:${expectation.pcbPortId}`,
          expectation,
        )
      }
    }
  }

  return [...expectationsByKey.values()]
}

function getCircuitPortForIpcPad(params: {
  ipcPad: Ipc2581Pad
  circuitPorts: Map<string, CircuitPort[]>
  offset: PointOffset
}) {
  const { ipcPad, circuitPorts, offset } = params
  const candidates = circuitPorts.get(getPadNodeKey(ipcPad)) ?? []
  if (candidates.length === 0) return undefined
  if (candidates.length === 1) return candidates[0]

  const transformedPadCenter = transformIpcPoint(ipcPad, offset)
  return candidates
    .map((candidate) => ({
      candidate,
      distanceSq:
        (candidate.x - transformedPadCenter.x) ** 2 +
        (candidate.y - transformedPadCenter.y) ** 2,
    }))
    .sort((a, b) => a.distanceSq - b.distanceSq)[0]?.candidate
}

function getCircuitTraceEndpoints(circuitJson: any[]) {
  const endpoints: CircuitTraceEndpoint[] = []
  for (const pcbTrace of circuitJson) {
    if (pcbTrace.type !== "pcb_trace") continue

    const wirePoints = pcbTrace.route.filter(
      (routePoint: any) => routePoint.route_type === "wire",
    )
    const firstWire = wirePoints[0]
    const lastWire = wirePoints[wirePoints.length - 1]

    for (const routePoint of [firstWire, lastWire]) {
      if (!routePoint) continue

      endpoints.push({
        point: { x: routePoint.x, y: routePoint.y },
        layer: routePoint.layer,
        portIds: new Set(
          [routePoint.start_pcb_port_id, routePoint.end_pcb_port_id].filter(
            Boolean,
          ),
        ),
        pcbTraceId: pcbTrace.pcb_trace_id,
      })
    }
  }

  return endpoints
}

function groupEndpointExpectationsByPoint(expectations: EndpointExpectation[]) {
  const expectationsByPoint = new Map<string, EndpointExpectation[]>()
  for (const expectation of expectations) {
    const key = getEndpointKey(expectation.point, expectation.layer)
    const existing = expectationsByPoint.get(key) ?? []
    existing.push(expectation)
    expectationsByPoint.set(key, existing)
  }
  return expectationsByPoint
}

function isPointInsideIpc2581Pad(
  point: { x: number; y: number },
  pad: Ipc2581Pad,
) {
  const local = getLocalPadPoint(point, pad)
  const tolerance = 1e-6

  if (pad.shape === "circle") {
    return local.x ** 2 + local.y ** 2 <= (pad.width / 2 + tolerance) ** 2
  }

  if (pad.shape === "oval") {
    return isPointInsidePill(local, pad.width, pad.height, tolerance)
  }

  return (
    Math.abs(local.x) <= pad.width / 2 + tolerance &&
    Math.abs(local.y) <= pad.height / 2 + tolerance
  )
}

function isPointInsidePill(
  local: { x: number; y: number },
  width: number,
  height: number,
  tolerance: number,
) {
  const radius = Math.min(width, height) / 2

  if (width >= height) {
    const centerHalfWidth = width / 2 - radius
    if (
      Math.abs(local.x) <= centerHalfWidth + tolerance &&
      Math.abs(local.y) <= radius + tolerance
    ) {
      return true
    }

    const capX = local.x < 0 ? -centerHalfWidth : centerHalfWidth
    return (local.x - capX) ** 2 + local.y ** 2 <= (radius + tolerance) ** 2
  }

  const centerHalfHeight = height / 2 - radius
  if (
    Math.abs(local.x) <= radius + tolerance &&
    Math.abs(local.y) <= centerHalfHeight + tolerance
  ) {
    return true
  }

  const capY = local.y < 0 ? -centerHalfHeight : centerHalfHeight
  return local.x ** 2 + (local.y - capY) ** 2 <= (radius + tolerance) ** 2
}

function getLocalPadPoint(
  point: { x: number; y: number },
  pad: { x: number; y: number; rotation: number },
) {
  const radians = (-pad.rotation * Math.PI) / 180
  const dx = point.x - pad.x
  const dy = point.y - pad.y
  return {
    x: dx * Math.cos(radians) - dy * Math.sin(radians),
    y: dx * Math.sin(radians) + dy * Math.cos(radians),
  }
}

function transformIpcPoint(
  point: { x: number; y: number },
  offset: PointOffset,
) {
  return {
    x: point.x + offset.x,
    y: point.y + offset.y,
  }
}

function getIpc2581LayerFeatures(ipc2581Text: string) {
  return [
    ...ipc2581Text.matchAll(
      /<[^:\s>]*:?LayerFeature\b(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/[^:\s>]*:?LayerFeature>/g,
    ),
  ]
    .map((match) => ({
      layerRef: getXmlAttribute(match.groups?.attrs ?? "", "layerRef"),
      body: match.groups?.body ?? "",
    }))
    .filter(
      (layerFeature): layerFeature is { layerRef: string; body: string } =>
        Boolean(layerFeature.layerRef),
    )
}

function getIpc2581SetMatches(body: string) {
  return body.matchAll(
    /<[^:\s>]*:?Set\b(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/[^:\s>]*:?Set>/g,
  )
}

function mapIpc2581LayerToCircuitLayer(layerRef: string) {
  if (layerRef === "F.Cu") return "top"
  if (layerRef === "B.Cu") return "bottom"

  const innerLayerMatch = layerRef.match(/^In([1-9]\d*)\.Cu$/)
  if (innerLayerMatch) return `inner${innerLayerMatch[1]}`

  return undefined
}

function getFirstElementAttrs(body: string, names: string[]) {
  for (const name of names) {
    const attrs = body.match(
      new RegExp(`<[^:\\s>]*:?${name}\\b(?<attrs>[^>]*)\\/?`),
    )?.groups?.attrs
    if (attrs) return attrs
  }
  return undefined
}

function getXmlAttribute(attrs: string, name: string) {
  return attrs
    .match(new RegExp(`\\b${escapeRegExp(name)}="([^"]*)"`))?.[1]
    ?.replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

function getPadNodeKey(pad: Ipc2581Pad) {
  return getNodeKey(pad.componentRef, pad.pin)
}

function getNodeKey(componentRef: string, pin: string) {
  return `${componentRef}.${pin}`
}

function getPointKey(point: { x: number; y: number }) {
  return `${Math.round(point.x * 1e4)},${Math.round(point.y * 1e4)}`
}

function getEndpointKey(point: { x: number; y: number }, layer: string) {
  return `${layer}:${getPointKey(point)}`
}

function getNetLayerKey(net: string, layer: string) {
  return `${layer}:${net}`
}

function median(values: number[]) {
  const sortedValues = [...values].sort((a, b) => a - b)
  return sortedValues[Math.floor(sortedValues.length / 2)]!
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
