import type { ManufacturingDrcProperties, SourceNetClass } from "circuit-json"
import { ConverterStage, type KicadNetClass } from "../../types"
import {
  getKicadNetClasses,
  isNetClassRegexSupported,
} from "./get-kicad-net-class"

/**
 * Board Setup > Constraints in KiCad, by what its DRC measures with each, and
 * the pcb_board minimums that bound the same distance. The minimum via annular
 * width, the microvia sizes and the silkscreen rules have no pcb_board field.
 */
const PCB_BOARD_FIELDS_BY_KICAD_RULE = {
  // Width of a track.
  min_track_width: ["min_trace_width"],
  // Pad diameter of a via.
  min_via_diameter: ["min_via_pad_diameter"],
  // Drill of a via or of a through-hole pad.
  min_through_hole_diameter: ["min_via_hole_diameter"],
  // Edge to edge distance of two drilled holes, of vias and pads alike.
  min_hole_to_hole: [
    "min_via_hole_edge_to_via_hole_edge_clearance",
    "min_plated_hole_drill_edge_to_drill_edge_clearance",
  ],
  // Hole edge to the copper of another item.
  min_hole_clearance: ["min_trace_to_hole_edge_clearance"],
  // Copper to the board edge.
  min_copper_edge_clearance: ["min_board_edge_clearance"],
  // Copper to copper of different nets: the floor under every net class.
  min_clearance: [
    "min_trace_to_pad_edge_clearance",
    "min_pad_edge_to_pad_edge_clearance",
    "min_different_net_trace_edge_to_trace_edge_clearance",
    "min_via_edge_to_pad_edge_clearance",
  ],
} satisfies Record<string, (keyof ManufacturingDrcProperties)[]>

/**
 * CollectProjectDesignRulesStage imports the design rules that KiCad 6+ keeps
 * in the project file (.kicad_pro) instead of the board file:
 * - Board Setup > Constraints → pcb_board min_* rules
 * - Net class track widths → source_net.trace_width
 */
export class CollectProjectDesignRulesStage extends ConverterStage {
  step(): boolean {
    this.collectBoardRules()
    this.collectNetTraceWidths()

    this.finished = true
    return false
  }

  private collectBoardRules() {
    const board = this.ctx.db.pcb_board.list()[0]
    const kicadRules = this.ctx.kicadProject?.board?.design_settings?.rules
    if (!board || !kicadRules) return

    const boardRules: ManufacturingDrcProperties = {}
    const boardFieldEntries = Object.entries(PCB_BOARD_FIELDS_BY_KICAD_RULE)
    for (const [kicadRule, boardFields] of boardFieldEntries) {
      const minimum = kicadRules[kicadRule]
      // KiCad stores 0 for a constraint that is not set, and a negative
      // copper edge clearance for the legacy outline-width rule.
      if (typeof minimum !== "number" || minimum <= 0) continue
      for (const boardField of boardFields) boardRules[boardField] = minimum
    }

    this.ctx.db.pcb_board.update(board.pcb_board_id, boardRules)
  }

  private collectNetTraceWidths() {
    const netSettings = this.ctx.kicadProject?.net_settings
    if (!netSettings || !this.ctx.netNumToSourceNetId) return

    // Keep definitions independently of their resolved width: unused classes,
    // inherited widths and distinct classes with equal widths all carry intent.
    const sourceNetClassIds = new Map<
      KicadNetClass,
      SourceNetClass["source_net_class_id"]
    >()
    for (const netClass of netSettings.classes ?? []) {
      if (!netClass.name) continue
      const traceWidth = netClass.track_width
      const priority = netClass.priority
      const sourceNetClass = this.ctx.db.source_net_class.insert({
        name: netClass.name,
        trace_width:
          typeof traceWidth === "number" &&
          Number.isFinite(traceWidth) &&
          traceWidth > 0
            ? traceWidth
            : undefined,
        priority:
          typeof priority === "number" &&
          Number.isInteger(priority) &&
          priority >= 0
            ? priority
            : undefined,
      })
      sourceNetClassIds.set(netClass, sourceNetClass.source_net_class_id)
    }

    for (const { pattern } of netSettings.netclass_patterns ?? []) {
      if (pattern === undefined || isNetClassRegexSupported(pattern)) continue
      this.ctx.warnings?.push(
        `Net class pattern "${pattern}" uses unsupported regular expression syntax; only its wildcard reading was applied`,
      )
    }

    for (const [netKey, sourceNetId] of this.ctx.netNumToSourceNetId) {
      const kicadNetName = this.ctx.netNumToKicadNetName?.get(netKey)
      if (!kicadNetName) continue

      // KiCad 9+ classes may leave the track width unset, which defers to the
      // next class of the net.
      const netClasses = getKicadNetClasses({ netSettings, kicadNetName })
      const source_net_class_ids = netClasses.flatMap((netClass) => {
        const id = sourceNetClassIds.get(netClass)
        return id === undefined ? [] : [id]
      })
      if (source_net_class_ids.length > 0) {
        this.ctx.db.source_net.update(sourceNetId, { source_net_class_ids })
      }
      const traceWidth = netClasses.find(
        (netClass) => typeof netClass.track_width === "number",
      )?.track_width
      if (traceWidth === undefined || traceWidth <= 0) continue

      this.ctx.db.source_net.update(sourceNetId, { trace_width: traceWidth })
    }
  }
}
