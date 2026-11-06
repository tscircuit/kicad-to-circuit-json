import type { Footprint } from "kicadts"
import { ConverterStage, type KicadNetKey } from "../../types"
import { getTopLevelCopperArcs } from "./arc-utils"
import { getFootprintReference } from "./CollectFootprintsStage/footprint-properties"
import { getKicadNetKey } from "./net-utils"
import { getSourcePortIdForPad } from "./pad-source-port-id"

/**
 * CollectSourceTracesStage extracts logical nets from KiCad PCB by analyzing net
 * assignments on pads and copper.
 *
 * This stage:
 * 1. Iterates through all footprints and their pads
 * 2. Builds a mapping of nets to connected pads
 * 3. Reuses source_port elements already created with pads
 * 4. Creates one source_net and one source_trace element for each net.
 */
export class CollectSourceTracesStage extends ConverterStage {
  private processedNets = new Set<KicadNetKey>()

  step(): boolean {
    if (!this.ctx.kicadPcb || !this.ctx.netNumToName) {
      this.finished = true
      return false
    }

    // Associate each declared PCB net with its existing source terminals.
    const netToPads = new Map<KicadNetKey, Set<string>>()

    for (const footprint of this.ctx.kicadPcb.footprints) {
      this.processFootprintPads(footprint, netToPads)
    }

    // Include nets that have copper traces even if there are fewer than 2 pads.
    // This guarantees routed copper can reference a source_net.
    this.collectNetsFromCopper(netToPads)

    // Create source_net elements for each discovered net.
    for (const [netKey, pads] of netToPads.entries()) {
      if (this.processedNets.has(netKey)) {
        continue
      }

      const sourcePortIds = [...pads]
      this.ctx.netNumToSourcePortIds?.set(netKey, sourcePortIds)
      this.createSourceTrace(netKey, sourcePortIds)
      this.processedNets.add(netKey)
    }

    this.finished = true
    return false
  }

  private collectNetsFromCopper(netToPads: Map<KicadNetKey, Set<string>>) {
    if (!this.ctx.kicadPcb) return

    const copper = [
      ...this.ctx.kicadPcb.segments,
      ...getTopLevelCopperArcs(this.ctx.kicadPcb),
      ...this.ctx.kicadPcb.vias,
    ]
    for (const element of copper) {
      const netKey = getKicadNetKey(element)
      if (netKey === null || netKey === 0) continue
      if (!netToPads.has(netKey)) {
        netToPads.set(netKey, new Set())
      }
    }
  }

  private processFootprintPads(
    footprint: Footprint,
    netToPads: Map<KicadNetKey, Set<string>>,
  ) {
    // Anonymous footprints are board-only copper/mechanical features, not
    // addressable source components. Keep their PCB geometry but do not invent
    // a reference such as U.1 in logical connectivity.
    if (!getFootprintReference(footprint)?.trim()) return

    // Extract UUID value (kicadts stores it in a .value property)
    const footprintUuid = footprint.uuid?.value || footprint.tstamp?.value
    if (!footprintUuid) return

    // Get the component ID for this footprint
    const componentId = this.ctx.footprintUuidToComponentId?.get(footprintUuid)
    if (!componentId) return

    // Get all pads from the footprint
    for (const pad of footprint.fpPads) {
      const padNumber = pad.number?.toString()
      if (!padNumber) continue

      // Get the net assignment for this pad
      const netKey = getKicadNetKey(pad)
      if (netKey === null || netKey === 0) {
        // Net 0 or undefined typically means no connection
        continue
      }

      const sourcePortId = getSourcePortIdForPad({
        ctx: this.ctx,
        componentId,
        footprint,
        pad,
      })
      if (!sourcePortId || !this.ctx.db.source_port.get(sourcePortId)) continue

      // Add to the net mapping
      if (!netToPads.has(netKey)) {
        netToPads.set(netKey, new Set())
      }

      netToPads.get(netKey)!.add(sourcePortId)
    }
  }

  private createSourceTrace(netKey: KicadNetKey, sourcePortIds: string[]) {
    const { db } = this.ctx
    const netName = this.ctx.netNumToName?.get(netKey) || `Net-${netKey}`
    const existingTraces = this.ctx.kicadSch
      ? db.source_trace
          .list()
          .filter(
            (trace) =>
              trace.connected_source_port_ids.some((id) =>
                sourcePortIds.includes(id),
              ) ||
              trace.connected_source_net_ids.some(
                (id) => db.source_net.get(id)?.name === netName,
              ),
          )
      : []
    let sourceNet = existingTraces[0]?.connected_source_net_ids[0]
      ? db.source_net.get(existingTraces[0].connected_source_net_ids[0])
      : undefined
    if (!sourceNet && this.ctx.kicadSch) {
      sourceNet = db.source_net.getWhere({ name: netName })
    }
    sourceNet ??= db.source_net.insert({
      name: netName,
      member_source_group_ids: [],
    })
    const connectedSourcePortIds = [
      ...new Set([
        ...existingTraces.flatMap((trace) => trace.connected_source_port_ids),
        ...sourcePortIds,
      ]),
    ]
    const connectedSourceNetIds = [
      ...new Set([
        ...existingTraces.flatMap((trace) => trace.connected_source_net_ids),
        sourceNet.source_net_id,
      ]),
    ]
    const data = {
      connected_source_port_ids: connectedSourcePortIds,
      connected_source_net_ids: connectedSourceNetIds,
    }
    const sourceTrace = existingTraces[0]
      ? db.source_trace.update(existingTraces[0].source_trace_id, data)
      : db.source_trace.insert({ ...data, display_name: netName })

    // Board copper may connect multiple drawn schematic paths. Keep every
    // drawing reference on the retained logical trace when those nets merge.
    if (existingTraces.length) {
      const mergedIds = new Set(
        existingTraces.map((trace) => trace.source_trace_id),
      )
      for (const trace of db.schematic_trace.list()) {
        if (trace.source_trace_id && mergedIds.has(trace.source_trace_id)) {
          db.schematic_trace.update(trace.schematic_trace_id, {
            source_trace_id: sourceTrace.source_trace_id,
            subcircuit_connectivity_map_key: sourceTrace.source_trace_id,
          })
        }
      }
      for (const label of db.schematic_net_label.list()) {
        if (label.source_trace_id && mergedIds.has(label.source_trace_id)) {
          db.schematic_net_label.update(label.schematic_net_label_id, {
            source_trace_id: sourceTrace.source_trace_id,
          })
        }
      }
      for (const trace of db.pcb_trace.list()) {
        if (
          trace.pcb_trace_id &&
          trace.source_trace_id &&
          mergedIds.has(trace.source_trace_id)
        ) {
          db.pcb_trace.update(trace.pcb_trace_id, {
            source_trace_id: sourceTrace.source_trace_id,
          })
        }
      }
      db.source_trace.update(sourceTrace.source_trace_id, {
        subcircuit_connectivity_map_key: sourceTrace.source_trace_id,
      })
      for (const netId of connectedSourceNetIds) {
        db.source_net.update(netId, {
          subcircuit_connectivity_map_key: sourceTrace.source_trace_id,
        })
      }
      for (const trace of existingTraces.slice(1)) {
        db.source_trace.delete(trace.source_trace_id)
      }
      for (const [key, id] of this.ctx.netNumToSourceTraceId ?? []) {
        if (mergedIds.has(id))
          this.ctx.netNumToSourceTraceId?.set(key, sourceTrace.source_trace_id)
      }
    }

    this.ctx.netNumToSourceNetId?.set(netKey, sourceNet.source_net_id)

    // Update stats
    if (this.ctx.stats) {
      this.ctx.stats.traces = (this.ctx.stats.traces || 0) + 1
    }

    this.ctx.netNumToSourceTraceId?.set(netKey, sourceTrace.source_trace_id)
  }
}
