import { expect, spyOn, test } from "bun:test"
import { readFileSync } from "node:fs"
import { cju } from "@tscircuit/circuit-json-util"
import {
  KicadFootprintToCircuitJsonConverter,
  KicadSymbolToCircuitJsonConverter,
  KicadToCircuitJsonConverter,
} from "../lib"

const cases = [
  { path: "hsp-usb-led.kicad_sch", standaloneSymbol: false },
  { path: "CM5IO.kicad_sym", standaloneSymbol: false },
  { path: "CM5IO.kicad_sym", standaloneSymbol: true },
  { path: "gr-circle-edge-cuts-fragment.kicad_pcb", standaloneSymbol: false },
  { path: "via_grid_template.kicad_pcb", standaloneSymbol: false },
]

for (const { path, standaloneSymbol } of cases) {
  test(`indexed database preserves ${path} output (standalone symbol: ${standaloneSymbol})`, () => {
    const contents = readFileSync(
      new URL(`./assets/${path}`, import.meta.url),
      "utf8",
    )
    const outputs = [false, true].map((unindexed) => {
      const converter = standaloneSymbol
        ? new KicadSymbolToCircuitJsonConverter()
        : new KicadToCircuitJsonConverter()
      converter.addFile(path, contents)
      converter.initializePipeline()
      if (unindexed) converter.ctx!.db = cju([])
      converter.runUntilFinished()
      return {
        output: JSON.parse(converter.getOutputString()),
        warnings: converter.getWarnings(),
        stats: converter.getStats(),
      }
    })
    expect(outputs[0]).toEqual(outputs[1])
  })
}

for (const thickness of [undefined, 0.8]) {
  test(`board insertion preserves optional material and thickness (${thickness})`, () => {
    const converter = new KicadToCircuitJsonConverter()
    converter.addFile(
      "board.kicad_pcb",
      `(kicad_pcb (version 20241229)
      ${thickness === undefined ? "" : `(general (thickness ${thickness}))`}
      (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
      (gr_rect (start 0 0) (end 20 10) (stroke (width 0.1) (type default))
        (fill none) (layer "Edge.Cuts")))`,
    )
    converter.runUntilFinished()
    const board = converter.ctx!.db.pcb_board.get("pcb_board_0")!
    expect(board).toMatchObject({
      width: 20,
      height: 10,
      num_layers: 2,
      thickness,
    })
    expect(Object.hasOwn(board, "material")).toBe(false)
    expect(converter.ctx!.db.pcb_board.list()).toHaveLength(1)
  })
}

test("standalone footprints retain indexed oval mounting holes", () => {
  const converter = new KicadFootprintToCircuitJsonConverter()
  converter.addFile(
    "slot.kicad_mod",
    `(footprint "Test:Slot"
    (layer "F.Cu")
    (property "Reference" "J1" (at 0 0 0) (layer "F.SilkS"))
    (pad "" np_thru_hole oval (at 1 2 30) (size 1 2)
      (drill oval 1 2) (layers "*.Cu" "*.Mask")))`,
  )
  converter.runUntilFinished()
  const hole = converter.ctx!.db.pcb_hole.get("pcb_hole_0")!
  expect(hole).toEqual({
    type: "pcb_hole",
    pcb_hole_id: "pcb_hole_0",
    pcb_component_id: "pcb_component_0",
    hole_shape: "rotated_pill",
    x: 1,
    y: -2,
    hole_width: 1,
    hole_height: 2,
    ccw_rotation: 30,
  })
  expect(converter.ctx!.db.pcb_hole.list()).toEqual([hole])
})

test("converting many nets does not scan the full database for lookups", () => {
  const netCount = 200
  const nets = Array.from({ length: netCount }, (_, i) => {
    const id = i + 1
    const x = id * 10
    return `(net ${id} "N${id}")
      (footprint "Test:Pair" (layer "F.Cu") (at ${x} 10)
        (uuid "pair-${id}") (property "Reference" "J${id}")
        (pad "1" smd circle (at 0 0) (size 1 1) (layers "F.Cu") (net ${id} "N${id}"))
        (pad "2" smd circle (at 4 0) (size 1 1) (layers "F.Cu") (net ${id} "N${id}")))
      (segment (start ${x} 10) (end ${x + 4} 10) (width 0.25) (layer "F.Cu") (net ${id}))`
  }).join("\n")
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "many-nets.kicad_pcb",
    `(kicad_pcb (version 20241229)
    (layers (0 "F.Cu" signal) (31 "B.Cu" signal)) ${nets})`,
  )
  converter.initializePipeline()
  const elements = converter.ctx!.db.toArray()
  const find = spyOn(elements, "find")
  const filter = spyOn(elements, "filter")
  try {
    converter.runUntilFinished()
    expect(find).not.toHaveBeenCalled()
    expect(filter).not.toHaveBeenCalled()
  } finally {
    find.mockRestore()
    filter.mockRestore()
  }
  expect(converter.ctx!.db.source_trace.list()).toHaveLength(netCount)
  expect(converter.ctx!.db.pcb_trace.list()).toHaveLength(netCount)
  expect(converter.ctx!.db.source_port.list()).toHaveLength(netCount * 2)
})
