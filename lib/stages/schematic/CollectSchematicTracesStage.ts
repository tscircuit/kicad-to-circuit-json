import { ConverterStage } from "../../types"
import { applyToPoint } from "transformation-matrix"
import type { Junction, PtsArc, Wire, Xy } from "kicadts"

const isXyPoint = (point: Xy | PtsArc): point is Xy =>
  "x" in point && "y" in point

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
    // Group wires by net/connection for better trace representation
    // For MVP, create one trace per wire
    for (const wire of this.ctx.kicadSch.wires) {
      this.processWire(wire)
    }

    // Process junctions
    for (const junction of this.ctx.kicadSch.junctions) {
      this.processJunction(junction)
    }

    this.finished = true
    return false
  }

  private processWire(wire: Wire) {
    if (!this.ctx.k2cMatSch) return

    // Get start and end points
    const pts = wire.points?.points.filter(isXyPoint) ?? []
    if (pts.length < 2) return

    const edges: Array<{
      from: { x: number; y: number }
      to: { x: number; y: number }
    }> = []

    // Convert wire segments to edges
    for (let i = 0; i < pts.length - 1; i++) {
      const fromPoint = pts[i]
      const toPoint = pts[i + 1]
      if (!fromPoint || !toPoint) continue

      const from = applyToPoint(this.ctx.k2cMatSch, {
        x: fromPoint.x,
        y: fromPoint.y,
      })
      const to = applyToPoint(this.ctx.k2cMatSch, {
        x: toPoint.x,
        y: toPoint.y,
      })

      edges.push({ from, to })
    }

    // Create schematic trace
    this.ctx.db.schematic_trace.insert({
      edges,
      junctions: [],
    })

    // Update stats
    if (this.ctx.stats) {
      this.ctx.stats.traces = (this.ctx.stats.traces || 0) + 1
    }
  }

  private processJunction(junction: Junction) {
    if (!this.ctx.k2cMatSch || !junction.at) return

    // Transform junction position
    const pos = applyToPoint(this.ctx.k2cMatSch, {
      x: junction.at.x,
      y: junction.at.y,
    })

    // Junctions in Circuit JSON are typically part of schematic_trace
    // For now, create a minimal trace with just a junction point
    // A more sophisticated approach would merge this with connected wires
    this.ctx.db.schematic_trace.insert({
      edges: [],
      junctions: [pos],
    })
  }
}
