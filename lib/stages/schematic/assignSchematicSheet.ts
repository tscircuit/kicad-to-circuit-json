import { getElementId } from "@tscircuit/circuit-json-util"
import type { ConverterContext } from "../../types"

/** Keep every imported primitive visible when the viewer selects this sheet. */
export function assignSchematicSheet(ctx: ConverterContext) {
  if (!ctx.schematicSheetId) return
  const types = [
    "schematic_component",
    "schematic_port",
    "schematic_trace",
    "schematic_text",
    "schematic_line",
    "schematic_path",
    "schematic_rect",
    "schematic_circle",
    "schematic_arc",
    "schematic_net_label",
    "schematic_box",
  ] as const
  for (const type of types) {
    for (const element of ctx.db[type].list()) {
      ctx.db[type].update(getElementId(element), {
        schematic_sheet_id: ctx.schematicSheetId,
      })
    }
  }
}
