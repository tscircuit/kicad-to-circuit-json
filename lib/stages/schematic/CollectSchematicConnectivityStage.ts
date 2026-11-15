import type { SchematicPort } from "circuit-json"
import { applyToPoint } from "transformation-matrix"
import { ConverterStage } from "../../types"
import { sourcePortMatchesPin } from "../../utils/get-or-create-source-port"
import { parseKicadOverlineText } from "../../utils/parse-kicad-overline-text"
import { getPinsForSymbolInstance } from "./emitKicadSymbolGeometry"
import {
  resolveSchematicConnectivity,
  type SchematicNetAnchor,
} from "./resolve-schematic-connectivity"
import {
  decodeKicadText,
  getOrCreateSchematicSourceNet,
  getSchematicPointKey as pointKey,
} from "./utils/schematic-net-utils"

/** Links drawn wires to their electrical nets without changing their paths. */
export class CollectSchematicConnectivityStage extends ConverterStage {
  step(): boolean {
    const { kicadSch, k2cMatSch, db } = this.ctx
    if (!kicadSch || !k2cMatSch) {
      this.finished = true
      return false
    }

    const traces = db.schematic_trace.list()
    const ports = db.schematic_port.list()
    const junctions = kicadSch.junctions.flatMap((junction) =>
      junction.at ? [applyToPoint(k2cMatSch, junction.at)] : [],
    )
    const labels = [...kicadSch.labels, ...kicadSch.globalLabels].flatMap(
      (label) =>
        label.at && label.value
          ? [
              {
                name: decodeKicadText(label.value),
                position: applyToPoint(k2cMatSch, label.at),
              },
            ]
          : [],
    )
    const groups = resolveSchematicConnectivity({
      traces,
      ports,
      junctions,
      labels,
      implicitLabels: this.getImplicitLabels(ports),
    })
    const sourceTraceIdByNetId = new Map<string, string>()
    for (const group of groups) {
      const sourcePortIds = [
        ...new Set(group.ports.map((p) => p.source_port_id)),
      ]
      if (
        group.traces.length === 0 &&
        (sourcePortIds.length === 0 ||
          (sourcePortIds.length === 1 && group.netNames.size === 0))
      ) {
        continue
      }
      const sourceNetIds = [...group.netNames].map(
        (name) => getOrCreateSchematicSourceNet(db, name).source_net_id,
      )
      const sourceTrace = db.source_trace.insert({
        connected_source_port_ids: sourcePortIds,
        connected_source_net_ids: sourceNetIds,
      })
      const connectivityKey = sourceTrace.source_trace_id
      db.source_trace.update(sourceTrace.source_trace_id, {
        subcircuit_connectivity_map_key: connectivityKey,
      })
      for (const sourceNetId of sourceNetIds) {
        sourceTraceIdByNetId.set(sourceNetId, sourceTrace.source_trace_id)
        db.source_net.update(sourceNetId, {
          subcircuit_connectivity_map_key: connectivityKey,
        })
      }
      const portsByPosition = new Map(
        group.ports.map((port) => [pointKey(port.center), port]),
      )
      for (const [index, trace] of group.traces.entries()) {
        db.schematic_trace.update(trace.schematic_trace_id, {
          source_trace_id: sourceTrace.source_trace_id,
          subcircuit_connectivity_map_key: connectivityKey,
          junctions: index === 0 ? group.junctions : [],
          edges: trace.edges.map((edge) => ({
            ...edge,
            from_schematic_port_id: portsByPosition.get(pointKey(edge.from))
              ?.schematic_port_id,
            to_schematic_port_id: portsByPosition.get(pointKey(edge.to))
              ?.schematic_port_id,
          })),
        })
      }
    }
    for (const label of db.schematic_net_label.list()) {
      const sourceTraceId = sourceTraceIdByNetId.get(label.source_net_id)
      if (sourceTraceId) {
        db.schematic_net_label.update(label.schematic_net_label_id, {
          source_trace_id: sourceTraceId,
        })
      }
    }

    this.finished = true
    return false
  }

  private getImplicitLabels(
    ports: readonly SchematicPort[],
  ): SchematicNetAnchor[] {
    const { db, kicadSch, symbolUuidToComponentId } = this.ctx
    const libraries = new Map(
      kicadSch!.libSymbols?.symbols.map((symbol) => [symbol.libraryId, symbol]),
    )
    const sourcePorts = new Map(
      db.source_port.list().map((port) => [port.source_port_id, port]),
    )
    const anchors: SchematicNetAnchor[] = []
    const portsByComponent = new Map<string, SchematicPort[]>()
    for (const port of ports) {
      if (!port.schematic_component_id) continue
      const componentPorts =
        portsByComponent.get(port.schematic_component_id) ?? []
      componentPorts.push(port)
      portsByComponent.set(port.schematic_component_id, componentPorts)
    }
    for (const symbol of kicadSch!.symbols) {
      const library = libraries.get(symbol.libraryId)
      const componentId =
        symbol.uuid && symbolUuidToComponentId?.get(symbol.uuid)
      if (!library || !componentId) continue
      const pins = getPinsForSymbolInstance(library, symbol)
      const componentPorts = portsByComponent.get(componentId) ?? []
      for (const pin of pins) {
        if (pin.pinElectricalType !== "power_in") continue
        const powerSymbol = library._sxPower && pins.length === 1
        let name: string | undefined
        if (powerSymbol) {
          name = symbol.properties.find(
            (property) => property.key === "Value",
          )?.value
        } else if (pin.hidden) {
          name = pin.name
        }
        if (!name) continue
        const pinNumber = parseKicadOverlineText(pin.numberString ?? "").text
        for (const port of componentPorts) {
          const sourcePort = sourcePorts.get(port.source_port_id)
          if (sourcePort && sourcePortMatchesPin(sourcePort, pinNumber)) {
            anchors.push({ name: decodeKicadText(name), position: port.center })
          }
        }
      }
    }
    return anchors
  }
}
