import type { Footprint, FootprintPad } from "kicadts"
import { ConverterStage, type KicadNetKey } from "../../types"
import { getTopLevelCopperArcs } from "./arc-utils"
import { getFootprintReference } from "./CollectFootprintsStage/footprint-properties"
import { getKicadNetKey } from "./net-utils"
import { getSourcePortIdForPad } from "./pad-source-port-id"

interface NetPadConnection {
  componentId: string
  padNumber: string
  sourcePortId: string
}

/**
 * CollectSourceTracesStage extracts logical nets from KiCad PCB by analyzing net
 * assignments on pads and copper.
 *
 * This stage:
 * 1. Iterates through all footprints and their pads
 * 2. Builds a mapping of nets to connected pads
 * 3. Creates source_port elements for each pad
 * 4. Creates one source_net and one source_trace element for each net.
 */
export class CollectSourceTracesStage extends ConverterStage {
  private processedNets = new Set<KicadNetKey>()

  step(): boolean {
    if (!this.ctx.kicadPcb || !this.ctx.netNumToName) {
      this.finished = true
      return false
    }

    // Build a map of net -> list of (component_id, pad_number, source_port_id)
    const netToPads = new Map<KicadNetKey, NetPadConnection[]>()

    // Extract all footprints from KiCad PCB
    // Process each footprint and its pads
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

      const sourcePortIds = this.getUniqueSourcePortIds(
        pads.map((p) => p.sourcePortId),
      )
      this.ctx.netNumToSourcePortIds?.set(netKey, sourcePortIds)
      const sourceNetId = this.createSourceNet(netKey)
      this.createSourceTrace(netKey, sourceNetId, sourcePortIds)
      this.processedNets.add(netKey)
    }

    this.finished = true
    return false
  }

  private collectNetsFromCopper(
    netToPads: Map<KicadNetKey, NetPadConnection[]>,
  ) {
    if (!this.ctx.kicadPcb) return

    for (const segment of this.ctx.kicadPcb.segments) {
      const netKey = getKicadNetKey(segment)
      if (netKey === null || netKey === 0) continue
      if (!netToPads.has(netKey)) {
        netToPads.set(netKey, [])
      }
    }

    const arcArray = getTopLevelCopperArcs(this.ctx.kicadPcb)
    for (const arc of arcArray) {
      const netKey = getKicadNetKey(arc)
      if (netKey === null || netKey === 0) continue
      if (!netToPads.has(netKey)) {
        netToPads.set(netKey, [])
      }
    }

    for (const via of this.ctx.kicadPcb.vias) {
      const netKey = getKicadNetKey(via)
      if (netKey === null || netKey === 0) continue
      if (!netToPads.has(netKey)) {
        netToPads.set(netKey, [])
      }
    }
  }

  private processFootprintPads(
    footprint: Footprint,
    netToPads: Map<KicadNetKey, NetPadConnection[]>,
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

      // Create a source_port for this pad if it doesn't exist
      const sourcePortId = this.getOrCreateSourcePort({
        componentId,
        padNumber,
        footprint,
        pad,
      })

      // Add to the net mapping
      if (!netToPads.has(netKey)) {
        netToPads.set(netKey, [])
      }

      netToPads.get(netKey)!.push({
        componentId,
        padNumber,
        sourcePortId,
      })
    }
  }

  private getOrCreateSourcePort(params: {
    componentId: string
    padNumber: string
    footprint: Footprint
    pad: FootprintPad
  }): string {
    const { componentId, padNumber, footprint, pad } = params
    const sourcePortId = getSourcePortIdForPad({
      componentId,
      footprint,
      pad,
    })
    if (!sourcePortId) return `${componentId}_port_${padNumber}`

    // Check if source_port already exists
    const existingPort = this.ctx.db.source_port
      .list()
      .find((sp: any) => sp.source_port_id === sourcePortId)

    if (!existingPort) {
      // Get the source_component_id from the footprint UUID mapping
      const footprintUuid = footprint.uuid?.value || footprint.tstamp?.value
      const sourceComponentId =
        footprintUuid && this.ctx.footprintUuidToSourceComponentId
          ? this.ctx.footprintUuidToSourceComponentId.get(footprintUuid)
          : undefined

      // Create the source_port
      this.ctx.db.source_port.insert({
        source_port_id: sourcePortId,
        source_component_id: sourceComponentId || componentId,
        name: this.getSourcePortName(padNumber),
        pin_number: this.getSourcePortPinNumber(padNumber),
      } as any)
    }

    return sourcePortId
  }

  private getSourcePortName(padNumber: string): string {
    if (/^\d+$/.test(padNumber)) {
      return `pin${Number(padNumber)}`
    }

    return padNumber
  }

  private getSourcePortPinNumber(padNumber: string): number | string {
    if (/^\d+$/.test(padNumber)) {
      return Number(padNumber)
    }

    return padNumber
  }

  private createSourceNet(netKey: KicadNetKey) {
    const netName = this.ctx.netNumToName?.get(netKey) || `Net-${netKey}`

    const sourceNet = this.ctx.db.source_net.insert({
      name: netName,
      member_source_group_ids: [],
    } as any)

    this.ctx.netNumToSourceNetId?.set(netKey, sourceNet.source_net_id)

    // Update stats
    if (this.ctx.stats) {
      this.ctx.stats.traces = (this.ctx.stats.traces || 0) + 1
    }

    return sourceNet.source_net_id
  }

  private createSourceTrace(
    netKey: KicadNetKey,
    sourceNetId: string,
    sourcePortIds: string[],
  ) {
    const netName = this.ctx.netNumToName?.get(netKey) || `Net-${netKey}`
    const sourceTrace = this.ctx.db.source_trace.insert({
      connected_source_port_ids: sourcePortIds,
      connected_source_net_ids: [sourceNetId],
      display_name: netName,
    })

    this.ctx.netNumToSourceTraceId?.set(netKey, sourceTrace.source_trace_id)
  }

  private getUniqueSourcePortIds(sourcePortIds: string[]) {
    const uniqueSourcePortIds: string[] = []
    for (const sourcePortId of sourcePortIds) {
      if (!uniqueSourcePortIds.includes(sourcePortId)) {
        uniqueSourcePortIds.push(sourcePortId)
      }
    }

    return uniqueSourcePortIds
  }
}
