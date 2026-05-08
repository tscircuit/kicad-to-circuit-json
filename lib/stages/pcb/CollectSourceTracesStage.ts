import type { Footprint } from "kicadts"
import { ConverterStage } from "../../types"
import { getTopLevelCopperArcs } from "./arc-utils"

/**
 * CollectSourceTracesStage extracts logical nets from KiCad PCB by analyzing net
 * assignments on pads and copper.
 *
 * This stage:
 * 1. Iterates through all footprints and their pads
 * 2. Builds a mapping of nets to connected pads
 * 3. Creates source_port elements for each pad
 * 4. Creates source_net elements for each net. Physical trace collection creates
 *    smaller source_trace elements that point at these source nets.
 */
export class CollectSourceTracesStage extends ConverterStage {
  private processedNets = new Set<number>()

  step(): boolean {
    if (!this.ctx.kicadPcb || !this.ctx.netNumToName) {
      this.finished = true
      return false
    }

    // Build a map of net -> list of (component_id, pad_number, source_port_id)
    const netToPads = new Map<
      number,
      Array<{
        componentId: string
        padNumber: string
        sourcePortId: string
      }>
    >()

    // Extract all footprints from KiCad PCB
    const footprints = this.ctx.kicadPcb.footprints || []
    const footprintArray = Array.isArray(footprints) ? footprints : [footprints]

    // Process each footprint and its pads
    for (const footprint of footprintArray) {
      this.processFootprintPads(footprint, netToPads)
    }

    // Include nets that have copper traces even if there are fewer than 2 pads.
    // This guarantees routed copper can reference a source_net.
    this.collectNetsFromCopper(netToPads)

    // Create source_net elements for each discovered net.
    for (const [netNum, pads] of netToPads.entries()) {
      if (this.processedNets.has(netNum)) {
        continue
      }

      this.createSourceNet(netNum)
      this.processedNets.add(netNum)
    }

    this.finished = true
    return false
  }

  private collectNetsFromCopper(
    netToPads: Map<
      number,
      Array<{
        componentId: string
        padNumber: string
        sourcePortId: string
      }>
    >,
  ) {
    if (!this.ctx.kicadPcb) return

    const segments = this.ctx.kicadPcb.segments || []
    const segmentArray = Array.isArray(segments) ? segments : [segments]

    for (const segment of segmentArray) {
      const netNum = this.getSegmentNet(segment)
      if (!netNum) continue
      if (!netToPads.has(netNum)) {
        netToPads.set(netNum, [])
      }
    }

    const arcArray = getTopLevelCopperArcs(this.ctx.kicadPcb)
    for (const arc of arcArray) {
      const netNum = this.getSegmentNet(arc)
      if (!netNum) continue
      if (!netToPads.has(netNum)) {
        netToPads.set(netNum, [])
      }
    }
  }

  private getSegmentNet(segment: any): number | null {
    const net = segment?.net
    if (!net) return null

    if (typeof net === "number") return net
    if (typeof net === "object") {
      return net._id ?? net.number ?? net.ordinal ?? null
    }

    return null
  }

  private processFootprintPads(
    footprint: Footprint,
    netToPads: Map<
      number,
      Array<{
        componentId: string
        padNumber: string
        sourcePortId: string
      }>
    >,
  ) {
    // Extract UUID value (kicadts stores it in a .value property)
    const footprintUuid = footprint.uuid?.value || footprint.tstamp?.value
    if (!footprintUuid) return

    // Get the component ID for this footprint
    const componentId = this.ctx.footprintUuidToComponentId?.get(footprintUuid)
    if (!componentId) return

    // Get all pads from the footprint
    const pads = footprint.fpPads || []
    const padArray = Array.isArray(pads) ? pads : [pads]

    for (const pad of padArray) {
      const padNumber = pad.number?.toString()
      if (!padNumber) continue

      // Get the net assignment for this pad
      const netNum = this.getPadNet(pad)
      if (netNum === null || netNum === undefined || netNum === 0) {
        // Net 0 or undefined typically means no connection
        continue
      }

      // Create a source_port for this pad if it doesn't exist
      const sourcePortId = this.getOrCreateSourcePort(
        componentId,
        padNumber,
        footprint,
      )

      // Add to the net mapping
      if (!netToPads.has(netNum)) {
        netToPads.set(netNum, [])
      }

      netToPads.get(netNum)!.push({
        componentId,
        padNumber,
        sourcePortId,
      })
    }
  }

  private getPadNet(pad: any): number | null {
    // Extract net number from pad
    // KiCad pads have a '_sxNet' property (from kicadts) or 'net' property
    const net = pad._sxNet || pad.net
    if (!net) return null

    // Net can be a number or an object with _id/_name properties (kicadts format)
    if (typeof net === "number") return net
    if (typeof net === "object") {
      return net._id ?? net.number ?? net.ordinal ?? null
    }

    return null
  }

  private getOrCreateSourcePort(
    componentId: string,
    padNumber: string,
    footprint: Footprint,
  ): string {
    // Create a unique source_port_id based on component and pad
    const sourcePortId = `${componentId}_port_${padNumber}`

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

  private createSourceNet(netNum: number) {
    const netName = this.ctx.netNumToName?.get(netNum) || `Net-${netNum}`

    const sourceNet = this.ctx.db.source_net.insert({
      name: netName,
      member_source_group_ids: [],
    } as any)

    this.ctx.netNumToSourceNetId?.set(netNum, sourceNet.source_net_id)

    // Update stats
    if (this.ctx.stats) {
      this.ctx.stats.traces = (this.ctx.stats.traces || 0) + 1
    }
  }
}
