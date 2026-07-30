import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../../lib"

test("preserves an abrupt trace-width transition at a shared corner", () => {
  const kicadPcb = `(kicad_pcb
    (version 20241229)
    (generator "pcbnew")
    (layers
      (0 "F.Cu" signal)
      (31 "B.Cu" signal)
      (44 "Edge.Cuts" user)
    )
    (net 0 "")
    (net 1 "GND")
    (gr_line (start 0 0) (end 20 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
    (gr_line (start 20 0) (end 20 20) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
    (gr_line (start 20 20) (end 0 20) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
    (gr_line (start 0 20) (end 0 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
    (segment (start 10 4) (end 10 10) (width 0.1) (layer "F.Cu") (net 1))
    (segment (start 10 10) (end 12 12) (width 0.25) (layer "F.Cu") (net 1))
    (segment (start 12 12) (end 18 12) (width 0.25) (layer "F.Cu") (net 1))
  )`

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("trace-width-transition.kicad_pcb", kicadPcb)
  converter.runUntilFinished()

  const pcbTrace = converter
    .getOutput()
    .find((element: any) => element.type === "pcb_trace") as any

  expect(pcbTrace).toBeDefined()

  expect(
    pcbTrace.route.map(({ x, y, width }: any) => ({ x, y, width })),
  ).toEqual([
    { x: 0, y: 6, width: 0.1 },
    { x: 0, y: 0, width: 0.25 },
    { x: 2, y: -2, width: 0.25 },
    { x: 8, y: -2, width: 0.25 },
  ])
})
