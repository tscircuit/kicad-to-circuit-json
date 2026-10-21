import { readFileSync } from "node:fs"
import { join } from "node:path"
import { type Footprint, parseKicadPcb } from "kicadts"
import { KicadFootprintToCircuitJsonConverter } from "../../lib/KicadFootprintToCircuitJsonConverter"
import { KicadToCircuitJsonConverter } from "../../lib/KicadToCircuitJsonConverter"

// Stock KiCad SOT-223-3_TabPin2 and R_0603_1608Metric geometry:
// CC-BY-SA-4.0 with the libraries exception: https://www.kicad.org/libraries/license/
// https://gitlab.com/kicad/libraries/kicad-footprints/-/tree/f8440fa61a5690b48b325c891fdb99c0038a5a59
const loadCourtyardBoard = () =>
  parseKicadPcb(
    readFileSync(
      join(import.meta.dir, "../assets/segmented-courtyard.kicad_pcb"),
      "utf8",
    ),
  )

export function convertCourtyardFootprint({
  angle = 0,
  layer = "top",
  modify,
}: {
  angle?: number
  layer?: "top" | "bottom"
  modify?: (footprint: Footprint) => void
} = {}) {
  const footprint = loadCourtyardBoard().footprints.find((footprint) =>
    footprint.properties.some(
      (property) => property.key === "Reference" && property.value === "U1",
    ),
  )!
  footprint.position = { x: 13, y: 17, angle }
  modify?.(footprint)
  const source = footprint.getString()
  const converter = new KicadFootprintToCircuitJsonConverter()
  converter.addFile(
    "SOT-223-3_TabPin2.kicad_mod",
    layer === "top" ? source : source.replaceAll('"F.', '"B.'),
  )
  return {
    circuitJson: converter.getOutput(),
    warnings: converter.getWarnings(),
  }
}

export function convertCourtyardBoard({ overlap = false } = {}) {
  const board = loadCourtyardBoard()
  if (overlap) {
    const resistor = board.footprints.find((footprint) =>
      footprint.properties.some(
        (property) => property.key === "Reference" && property.value === "R1",
      ),
    )!
    resistor.position = { x: -1.3, y: 0 }
  }
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("courtyard-board.kicad_pcb", board.getString())
  converter.runUntilFinished()
  return converter.getOutput()
}
