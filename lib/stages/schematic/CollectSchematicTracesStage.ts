import { ConverterStage } from "../../types"
import { applyToPoint } from "transformation-matrix"
import { mapJustifyToAnchor } from "./utils/mapJustifyToAnchor"

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
      this.processWire(wire, false)
    }

    // Process buses identically to wires for schematic tracing
    const buses = (this.ctx.kicadSch as any).buses || []
    for (const bus of (Array.isArray(buses) ? buses : [buses])) {
      this.processWire(bus, true)
    }

    // Process beziers identically to wires since they both provide pts
    const beziers = (this.ctx.kicadSch as any).beziers || []
    for (const bezier of (Array.isArray(beziers) ? beziers : [beziers])) {
      this.processWire(bezier, false)
    }

    // Process junctions
    const junctions = this.ctx.kicadSch.junctions || []
    const junctionArray = Array.isArray(junctions) ? junctions : [junctions]

    for (const junction of junctionArray) {
      this.processJunction(junction)
    }

    // Process Bus entries which connect a bus to a wire
    const busEntries = (this.ctx.kicadSch as any).busEntries || []
    for (const entry of (Array.isArray(busEntries) ? busEntries : [busEntries])) {
      this.processBusEntry(entry)
    }

    // Process semantic net labels
    const labelArrays = ["labels", "global_labels", "hierarchical_labels", "no_connects"];
    for (const key of labelArrays) {
       const group = (this.ctx.kicadSch as any)[key] || [];
       for (const label of (Array.isArray(group) ? group : [group])) {
          this.processLabel(label)
       }
    }

    this.finished = true
    return false
  }

  private processWire(wire: any, isBus: boolean = false) {
    if (!this.ctx.k2cMatSch) return
    const ptsObj = wire.pts || wire._sxPts || wire;
    const xyData = ptsObj.points || ptsObj.xy;
    if (!xyData) return;

    // Get start and end points
    const pts = Array.isArray(xyData) ? xyData : [xyData]
    if (pts.length < 2) return

    const edges: Array<{
      from: { x: number; y: number }
      to: { x: number; y: number }
    }> = []

    // Convert wire segments to edges
    for (let i = 0; i < pts.length - 1; i++) {
      const from = applyToPoint(this.ctx.k2cMatSch, {
        x: pts[i].x,
        y: pts[i].y,
      })
      const to = applyToPoint(this.ctx.k2cMatSch, {
        x: pts[i + 1].x,
        y: pts[i + 1].y,
      })

      edges.push({ from, to })
    }

    // Create schematic trace
    this.ctx.db.schematic_trace.insert({
      edges: edges,
      ...(isBus ? { is_bus: true, stroke_width: 2 } : {})
    } as any)

    // Update stats
    if (this.ctx.stats) {
      this.ctx.stats.traces = (this.ctx.stats.traces || 0) + 1
    }
  }

  private processJunction(junction: any) {
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
    } as any)
  }

  private processBusEntry(entry: any) {
    if (!this.ctx.k2cMatSch || !entry.at) return

    // Transform junction position
    const pos = applyToPoint(this.ctx.k2cMatSch, {
      x: entry.at.x,
      y: entry.at.y,
    })

    // Just insert a junction constraint to act as the visual tap point
    this.ctx.db.schematic_trace.insert({
      edges: [],
      junctions: [pos],
    } as any)
  }

  private processLabel(label: any) {
    if (!this.ctx.k2cMatSch || !label.at) return

    const pos = applyToPoint(this.ctx.k2cMatSch, {
      x: label.at.x,
      y: label.at.y,
    })
    
    const text = label.text || label.name || label.value || label._value;
    if (!text) return;
    
    const scaleFactor = Math.abs(this.ctx.k2cMatSch.a || 1 / 15);
    
    let color = "#000000";
    if (label.token === "global_label") color = "#0000A0";
    else if (label.token === "hierarchical_label") {
        color = "#008000";
        // Create structural port mapping for hierarchical pins natively
        const safeText = text.replace(/[^a-zA-Z0-9_]/g, "_");
        const sourceCompId = `source_component_hier_${safeText}`;
        if (!this.ctx.db.source_component.list().some((sc: any) => sc.source_component_id === sourceCompId)) {
            this.ctx.db.source_component.insert({
                source_component_id: sourceCompId,
                name: text,
                ftype: "simple_port" as any
            } as any);
        }
        
        const schComp = this.ctx.db.schematic_component.insert({
            source_component_id: sourceCompId,
            center: pos,
            size: { width: 0, height: 0 }
        } as any);
        
        const sourcePort = this.ctx.db.source_port.insert({
            source_component_id: sourceCompId,
            name: text,
        } as any);
        
        this.ctx.db.schematic_port.insert({
            schematic_component_id: schComp.schematic_component_id,
            source_port_id: sourcePort.source_port_id,
            center: pos,
            facing_direction: "right",
        } as any);
    }
    else color = "#800000";

    if (label.token === "no_connect") {
       const size = 1.0 * scaleFactor;
       this.ctx.db.schematic_line.insert({
           x1: pos.x - size, y1: pos.y - size,
           x2: pos.x + size, y2: pos.y + size,
           color: color, is_dashed: false
       } as any);
       this.ctx.db.schematic_line.insert({
           x1: pos.x - size, y1: pos.y + size,
           x2: pos.x + size, y2: pos.y - size,
           color: color, is_dashed: false
       } as any);
       return;
    }

    const anchor = mapJustifyToAnchor((label as any)._sxEffects?._sxJustify ?? label.justify) || "center";

    this.ctx.db.schematic_text.insert({
      text: text,
      position: pos,
      anchor: anchor,
      color: color,
      font_size: ((label as any)._sxEffects?._sxFont?._sxSize?._height ?? 1.27) * scaleFactor,
      rotation: label.at.angle ?? 0,
    } as any)
  }
}

