import { ConverterStage } from "../../types"
import type { Footprint } from "kicadts"

/**
 * CollectSourceTracesStage extracts logical connectivity (ratsnest) from KiCad PCB
 * by analyzing net assignments on pads and creating source_trace elements.
 *
 * This stage:
 * 1. Iterates through all footprints and their pads
 * 2. Builds a mapping of nets to connected pads
 * 3. Creates source_port elements for each pad
 * 4. Creates source_trace elements for each net that connects multiple pads
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

    // Create source_trace elements for each net with multiple connections
    for (const [netNum, pads] of netToPads.entries()) {
      if (pads.length < 2 || this.processedNets.has(netNum)) {
        continue
      }

      this.createSourceTrace(netNum, pads)
      this.processedNets.add(netNum)
    }

    this.finished = true
    return false
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

      // Get the reference (component name) from footprint properties
      const reference = this.getFootprintReference(footprint)

      // Create the source_port
      this.ctx.db.source_port.insert({
        source_port_id: sourcePortId,
        source_component_id: sourceComponentId || componentId,
        name: `${reference || "U"}.${padNumber}`,
        pin_number: parseInt(padNumber, 10) || undefined,
      } as any)
    }

    return sourcePortId
  }

  private getFootprintReference(footprint: Footprint): string | undefined {
    // Try to get reference from properties first
    const properties = footprint.properties || []
    const propertyArray = Array.isArray(properties) ? properties : [properties]

    for (const property of propertyArray) {
      if (
        (property as any).key === "Reference" ||
        (property as any).name === "Reference"
      ) {
        return (property as any).value
      }
    }

    // Fallback: try fpTexts
    const textItems = footprint.fpTexts || []
    const textArray = Array.isArray(textItems) ? textItems : [textItems]

    for (const text of textArray) {
      // FpText objects have a type field that indicates reference/value
      if ((text as any).type === "reference") {
        return text.text
      }
    }

    return undefined
  }

  private createSourceTrace(
    netNum: number,
    pads: Array<{
      componentId: string
      padNumber: string
      sourcePortId: string
    }>,
  ) {
    const netName = this.ctx.netNumToName?.get(netNum) || `Net-${netNum}`

    // Create the source_trace
    this.ctx.db.source_trace.insert({
      connected_source_port_ids: pads.map((p) => p.sourcePortId),
      connected_source_net_ids: [], // Can be populated if we track source_net elements
      display_name: netName,
    } as any)

    // Update stats
    if (this.ctx.stats) {
      this.ctx.stats.traces = (this.ctx.stats.traces || 0) + 1
    }
  }
}
