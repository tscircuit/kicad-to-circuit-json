import { expect, test } from "bun:test"
import { SchematicSymbol, SxClass, SymbolArc } from "kicadts"
import { getKicadSymbolArcPoints } from "../lib/getKicadSymbolArcPoints"

test("derives the midpoint of legacy KiCad symbol arcs", () => {
  const [parsed] = SxClass.parse(`
    (symbol "Legacy:Arc"
      (arc
        (start -6.985 12.7)
        (end -6.985 11.176)
        (radius
          (at -6.985 11.938)
          (length 0.762)
          (angles 90 -90)
        )
      )
    )
  `)
  expect(parsed).toBeInstanceOf(SchematicSymbol)
  const arc = (parsed as SchematicSymbol).arcs[0] as SymbolArc

  expect(getKicadSymbolArcPoints(arc)).toEqual({
    start: { x: -6.985, y: 12.7 },
    mid: { x: -7.747, y: 11.938 },
    end: { x: -6.985, y: 11.176 },
  })
})
