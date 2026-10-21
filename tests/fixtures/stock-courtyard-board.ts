import { readFileSync } from "node:fs"
import { join } from "node:path"
import { type Footprint, parseKicadMod } from "kicadts"
import { KicadFootprintToCircuitJsonConverter } from "../../lib/KicadFootprintToCircuitJsonConverter"
import { KicadToCircuitJsonConverter } from "../../lib/KicadToCircuitJsonConverter"

// Unmodified KiCad footprints (CC-BY-SA-4.0 with the libraries exception):
// https://www.kicad.org/libraries/license/
// https://gitlab.com/kicad/libraries/kicad-footprints/-/tree/f8440fa61a5690b48b325c891fdb99c0038a5a59
// Package_TO_SOT_SMD.pretty, Connector_Molex.pretty, Resistor_SMD.pretty.
export const stockCourtyardFootprints = [
  {
    name: "SOT-223-3_TabPin2",
    label: "SOT-223-3_TabPin2",
    reference: "U1",
    position: { x: -7, y: 0 },
  },
  {
    name: "Molex_Micro-Fit_3.0_43650-0200_1x02_P3.00mm_Horizontal",
    label: "Molex Micro-Fit 43650-0200",
    reference: "J1",
    position: { x: -6, y: 4 },
  },
] as const

export type StockCourtyardFootprint = (typeof stockCourtyardFootprints)[number]

export function loadStockFootprint(name: string, reference: string) {
  const footprint = parseKicadMod(
    readFileSync(
      join(
        import.meta.dir,
        "../assets/courtyard-segments",
        `${name}.kicad_mod`,
      ),
      "utf8",
    ),
  )
  footprint.properties.find((property) => property.key === "Reference")!.value =
    reference
  return footprint
}

export function convertStockCourtyardFootprint(
  stockFootprint: StockCourtyardFootprint,
  {
    angle = 0,
    layer = "top",
    modify,
  }: {
    angle?: number
    layer?: "top" | "bottom"
    modify?: (footprint: Footprint) => void
  } = {},
) {
  const footprint = loadStockFootprint(
    stockFootprint.name,
    stockFootprint.reference,
  )
  footprint.position = { x: 13, y: 17, angle }
  modify?.(footprint)
  const source = footprint.getString()
  const converter = new KicadFootprintToCircuitJsonConverter()
  converter.addFile(
    `${stockFootprint.name}.kicad_mod`,
    layer === "top" ? source : source.replaceAll('"F.', '"B.'),
  )
  return {
    circuitJson: converter.getOutput(),
    warnings: converter.getWarnings(),
  }
}

export function convertStockCourtyardBoard(
  stockFootprint: StockCourtyardFootprint,
  { overlap = false } = {},
) {
  const footprint = loadStockFootprint(
    stockFootprint.name,
    stockFootprint.reference,
  )
  footprint.position = stockFootprint.position
  footprint.uuid = "00000000-0000-4000-8000-000000000001"
  const resistor = loadStockFootprint("R_0603_1608Metric", "R1")
  resistor.position = { x: overlap ? -1.3 : 8, y: 0 }
  resistor.uuid = "00000000-0000-4000-8000-000000000002"
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "courtyard-board.kicad_pcb",
    `(kicad_pcb
    (version 20260206) (generator "pcbnew") (general (thickness 1.6))
    (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user)
      (46 "B.CrtYd" user) (47 "F.CrtYd" user))
    (gr_rect (start -15 -10) (end 15 10) (stroke (width 0.05) (type default)) (fill none) (layer "Edge.Cuts"))
    ${footprint.getString()}
    ${resistor.getString()}
  )`,
  )
  converter.runUntilFinished()
  return converter.getOutput()
}
