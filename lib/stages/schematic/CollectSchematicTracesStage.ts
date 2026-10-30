import { ConverterStage } from "../../types"
import { applyToPoint } from "transformation-matrix"
import type { PtsArc, Wire, Xy } from "kicadts"

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

    // Preserve each wire's continuous drawing path. The connectivity stage
    // links wires in the same net and attaches their junctions afterward.
    for (const wire of this.ctx.kicadSch.wires) {
      this.processWire(wire)
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
}
