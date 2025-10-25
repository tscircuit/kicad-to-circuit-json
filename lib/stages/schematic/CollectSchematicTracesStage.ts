import { ConverterStage } from "../../types"
import { applyToPoint } from "transformation-matrix"

/**
 * CollectSchematicTracesStage converts KiCad schematic wires and junctions
 * into Circuit JSON schematic_trace elements.
 */
export class CollectSchematicTracesStage extends ConverterStage {
  step(): boolean {
    if (!this.ctx.kicadSch || !this.ctx.k2cMatSch) {
      this.finished = true
      return false
    }

    // Process wires
    const wires = this.ctx.kicadSch.wires || []
    const wireArray = Array.isArray(wires) ? wires : [wires]

    // Group wires by net/connection for better trace representation
    // For MVP, create one trace per wire
    for (const wire of wireArray) {
      this.processWire(wire)
    }

    // Process junctions
    const junctions = this.ctx.kicadSch.junctions || []
    const junctionArray = Array.isArray(junctions) ? junctions : [junctions]

    for (const junction of junctionArray) {
      this.processJunction(junction)
    }

    this.finished = true
    return false
  }

  private processWire(wire: any) {
    if (!this.ctx.k2cMatSch || !wire.pts) return

    // Get start and end points
    const pts = Array.isArray(wire.pts.xy) ? wire.pts.xy : [wire.pts.xy]
    if (pts.length < 2) return

    const edges: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }> = []

    // Convert wire segments to edges
    for (let i = 0; i < pts.length - 1; i++) {
      const from = applyToPoint(this.ctx.k2cMatSch, { x: pts[i].x, y: pts[i].y })
      const to = applyToPoint(this.ctx.k2cMatSch, { x: pts[i + 1].x, y: pts[i + 1].y })

      edges.push({ from, to })
    }

    // Create schematic trace
    this.ctx.db.schematic_trace.insert({
      edges: edges,
    } as any)

    // Update stats
    if (this.ctx.stats) {
      this.ctx.stats.traces = (this.ctx.stats.traces || 0) + 1
    }
  }

  private processJunction(junction: any) {
    if (!this.ctx.k2cMatSch || !junction.at) return

    // Transform junction position
    const pos = applyToPoint(this.ctx.k2cMatSch, { x: junction.at.x, y: junction.at.y })

    // Junctions in Circuit JSON are typically part of schematic_trace
    // For now, create a minimal trace with just a junction point
    // A more sophisticated approach would merge this with connected wires
    this.ctx.db.schematic_trace.insert({
      edges: [],
      junctions: [pos],
    } as any)
  }
}
