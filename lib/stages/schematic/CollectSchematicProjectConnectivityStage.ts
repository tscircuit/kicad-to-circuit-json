import type { Point } from "circuit-json"
import { SymbolPower } from "kicadts"
import { applyToPoint } from "transformation-matrix"
import type { SchematicSheetInstance } from "../../schematic-project/load-schematic-project"
import { type ConverterContext, ConverterStage } from "../../types"
import { getPinsForSymbolInstance } from "./emitKicadSymbolGeometry"

export interface ProjectSheetContext {
  instance: SchematicSheetInstance
  ctx: ConverterContext
}

class Connections {
  private parents = new Map<string, string>()

  find(key: string): string {
    if (!this.parents.has(key)) this.parents.set(key, key)
    let root = key
    while (this.parents.get(root) !== root) root = this.parents.get(root)!
    while (key !== root) {
      const parent = this.parents.get(key)!
      this.parents.set(key, root)
      key = parent
    }
    return root
  }

  join(left: string, right: string) {
    const a = this.find(left)
    const b = this.find(right)
    if (a !== b) this.parents.set(b, a)
  }
}

const labelText = (value: string) => value.replaceAll("{slash}", "/")
const localLabelKey = (path: string, name: string) =>
  JSON.stringify(["label", path, labelText(name)])

function isOnSegment(point: Point, from: Point, to: Point) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (!length) return Math.hypot(point.x - from.x, point.y - from.y) < 1e-6
  return (
    Math.abs((point.x - from.x) * dy - (point.y - from.y) * dx) / length <
      1e-6 &&
    point.x >= Math.min(from.x, to.x) - 1e-6 &&
    point.x <= Math.max(from.x, to.x) + 1e-6 &&
    point.y >= Math.min(from.y, to.y) - 1e-6 &&
    point.y <= Math.max(from.y, to.y) + 1e-6
  )
}

/** Resolve scalar nets after all sheet instances have emitted their ports. */
export class CollectSchematicProjectConnectivityStage extends ConverterStage {
  constructor(
    ctx: ConverterContext,
    private sheets: ProjectSheetContext[],
  ) {
    super(ctx)
  }

  step(): boolean {
    const graph = new Connections()
    const portNodes: { key: string; portId: string }[] = []
    const labels: { key: string; name: string; global: boolean }[] = []
    const wires: { key: string; traceId: string }[] = []
    const sourcePorts = new Map(
      this.ctx.db.source_port.list().map((port) => [port.source_port_id, port]),
    )

    for (const { instance, ctx } of this.sheets) {
      const { schematic, instancePath } = instance
      const points = new Map<string, Point>()
      const pointKey = (position: Point) => {
        const key = JSON.stringify([
          instancePath,
          position.x.toFixed(6),
          position.y.toFixed(6),
        ])
        points.set(key, position)
        graph.find(key)
        return key
      }
      const atKey = (position: Point) =>
        pointKey(applyToPoint(ctx.k2cMatSch!, position))
      const componentIds = new Set(ctx.symbolUuidToComponentId?.values())
      for (const port of this.ctx.db.schematic_port.list()) {
        if (
          !port.schematic_component_id ||
          !componentIds.has(port.schematic_component_id)
        )
          continue
        const key = pointKey(port.center)
        // The same physical terminal can occur on more than one symbol unit.
        graph.join(key, `port:${port.source_port_id}`)
        portNodes.push({ key, portId: port.source_port_id })
      }

      const registerLabel = (
        name: string,
        position: Point,
        global: boolean,
      ) => {
        const key = localLabelKey(instancePath, name)
        graph.join(atKey(position), key)
        if (global) graph.join(key, JSON.stringify(["global", labelText(name)]))
        labels.push({
          key,
          name: global ? labelText(name) : `${instancePath}/${labelText(name)}`,
          global,
        })
      }
      for (const label of [
        ...schematic.labels,
        ...instance.hierarchicalLabels,
      ]) {
        if (label.at) registerLabel(label.value, label.at, false)
      }
      for (const label of schematic.globalLabels) {
        if (label.at) registerLabel(label.value, label.at, true)
      }
      for (const symbol of schematic.symbols) {
        const librarySymbol = schematic.libSymbols?.symbols.find(
          (entry) => entry.libraryId === symbol.libraryId,
        )
        const power = librarySymbol
          ?.getChildren()
          .find((entry): entry is SymbolPower => entry instanceof SymbolPower)
        // PWR_FLAG is also marked (power), but its power_out terminal asserts
        // ERC drive strength; repeated flags must not short unrelated nets.
        // Legacy libraries also use hidden power_in pins without (power).
        if (!librarySymbol) continue
        const implicitPins = getPinsForSymbolInstance(
          librarySymbol,
          symbol,
        ).filter(
          (pin) =>
            pin.pinElectricalType === "power_in" && (power || pin.hidden),
        )
        const value = symbol.properties.find(
          (property) => property.key === "Value",
        )?.value
        const componentId =
          symbol.uuid && ctx.symbolUuidToComponentId?.get(symbol.uuid)
        if (!componentId) continue
        for (const port of this.ctx.db.schematic_port.list()) {
          if (port.schematic_component_id !== componentId) continue
          const sourcePort = sourcePorts.get(port.source_port_id)
          const implicitPin =
            sourcePort &&
            implicitPins.find(
              (pin) =>
                pin.numberString ===
                (sourcePort.pin_number?.toString() ??
                  sourcePort.port_hints?.[0]),
            )
          const name = power ? value : implicitPin?.name
          if (!implicitPin || !name) continue
          const key = pointKey(port.center)
          const global = power?.value !== "local"
          graph.join(
            key,
            global
              ? JSON.stringify(["global", labelText(name)])
              : localLabelKey(instancePath, name),
          )
          labels.push({
            key,
            name: global
              ? labelText(name)
              : `${instancePath}/${labelText(name)}`,
            global,
          })
        }
      }
      for (const child of this.sheets) {
        if (child.instance.parentPath !== instancePath) continue
        for (const pin of child.instance.parentSheet?.pins ?? []) {
          if (!pin.position) continue
          if (
            !child.instance.hierarchicalLabels.some(
              (label) => labelText(label.value) === labelText(pin.name),
            )
          ) {
            this.ctx.warnings?.push(
              `Sheet pin "${pin.name}" in "${instance.filePath}" has no matching hierarchical label in "${child.instance.filePath}" (${child.instance.instancePath}).`,
            )
            continue
          }
          graph.join(
            atKey(pin.position),
            localLabelKey(child.instance.instancePath, pin.name),
          )
        }
      }
      for (const junction of schematic.junctions) {
        if (junction.at) atKey(junction.at)
      }
      const segments: { from: Point; to: Point; key: string }[] = []
      for (const wire of schematic.wires) {
        const vertices =
          wire.points?.points
            .filter(
              (point): point is typeof point & Point =>
                "x" in point && "y" in point,
            )
            .map((point) => applyToPoint(ctx.k2cMatSch!, point)) ?? []
        const keys = vertices.map(pointKey)
        for (let index = 1; index < vertices.length; index++) {
          graph.join(keys[index - 1]!, keys[index]!)
          segments.push({
            from: vertices[index - 1]!,
            to: vertices[index]!,
            key: keys[index]!,
          })
        }
        const traceId = ctx.schematicWireTraceIds?.get(wire)
        if (traceId && keys.length) wires.push({ key: keys[0]!, traceId })
      }
      // Split wires at endpoints, pins, labels and explicit junctions. Two wires
      // crossing in their interiors remain separate unless a junction exists.
      for (const segment of segments) {
        for (const [key, point] of points) {
          if (isOnSegment(point, segment.from, segment.to))
            graph.join(segment.key, key)
        }
      }
    }

    const nets = new Map<
      string,
      { ports: Set<string>; names: typeof labels; wires: string[] }
    >()
    const getNet = (key: string) => {
      const root = graph.find(key)
      let net = nets.get(root)
      if (!net) {
        net = { ports: new Set(), names: [], wires: [] }
        nets.set(root, net)
      }
      return net
    }
    for (const port of portNodes) getNet(port.key).ports.add(port.portId)
    for (const label of labels) getNet(label.key).names.push(label)
    for (const wire of wires) getNet(wire.key).wires.push(wire.traceId)
    const netIds = new Map<string, string>()
    for (const [root, net] of nets) {
      if (net.ports.size < 2 && !net.names.length && !net.wires.length) continue
      const name =
        net.names.find((entry) => entry.global)?.name ??
        net.names[0]?.name ??
        `Net-${netIds.size + 1}`
      const sourceNet = this.ctx.db.source_net.insert({
        name,
        member_source_group_ids: [],
      })
      netIds.set(root, sourceNet.source_net_id)
      const trace = this.ctx.db.source_trace.insert({
        connected_source_port_ids: [...net.ports],
        connected_source_net_ids: [sourceNet.source_net_id],
      })
      for (const traceId of net.wires) {
        this.ctx.db.schematic_trace.update(traceId, {
          source_trace_id: trace.source_trace_id,
        })
      }
    }
    for (const { instance, ctx } of this.sheets) {
      for (const label of [
        ...instance.schematic.labels,
        ...instance.schematic.globalLabels,
        ...instance.hierarchicalLabels,
      ]) {
        const id = netIds.get(
          graph.find(localLabelKey(instance.instancePath, label.value)),
        )
        if (id) ctx.schematicNetIds?.set(labelText(label.value), id)
      }
    }
    this.finished = true
    return false
  }
}
