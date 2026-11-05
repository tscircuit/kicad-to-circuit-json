import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../lib"

const SCHEMATIC_WITH_TEXT_BOXES_AND_TABLE = `(kicad_sch
  (version 20231120)
  (generator "eeschema")
  (generator_version "8.0")
  (uuid "00000000-0000-0000-0000-000000000001")
  (paper "A4")
  (lib_symbols)
  (text_box "Design Notes{slash}Rev A"
    (exclude_from_sim no)
    (at 50 40 0)
    (size 30 15)
    (stroke (width 0.3) (type dash))
    (fill (type background))
    (effects (font (size 1.5 1.5)) (justify left top))
    (uuid "00000000-0000-0000-0000-000000000002")
  )
  (text_box "Hidden Box Text"
    (exclude_from_sim no)
    (at 90 40 0)
    (size 20 10)
    (stroke (width 0) (type none))
    (fill (type none))
    (effects (font (size 1.27 1.27)) (hide yes))
    (uuid "00000000-0000-0000-0000-000000000003")
  )
  (table
    (column_count 2)
    (border (external yes) (header yes) (stroke (width 0.15) (type solid)))
    (separators (rows yes) (cols yes) (stroke (width 0.15) (type solid)))
    (column_widths 20 20)
    (row_heights 10)
    (cells
      (table_cell "Pin"
        (exclude_from_sim no)
        (at 50 70 0)
        (size 20 10)
        (margins 1 1 1 1)
        (span 1 1)
        (fill (type none))
        (effects (font (size 1.27 1.27)) (justify left))
        (uuid "00000000-0000-0000-0000-000000000004")
      )
      (table_cell "~{RESET}"
        (exclude_from_sim no)
        (at 70 70 0)
        (size 20 10)
        (margins 1 1 1 1)
        (span 1 1)
        (fill (type background))
        (effects (font (size 1.27 1.27)))
        (uuid "00000000-0000-0000-0000-000000000005")
      )
    )
  )
)`

test("converts schematic text_box and table annotations into schematic_rect and schematic_text", () => {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "text-boxes-and-table.kicad_sch",
    SCHEMATIC_WITH_TEXT_BOXES_AND_TABLE,
  )
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  const rects = circuitJson.filter(
    (element) => element.type === "schematic_rect",
  )
  const texts = circuitJson.filter(
    (element) => element.type === "schematic_text",
  )

  expect(rects).toHaveLength(3)
  expect(rects[0]).toMatchObject({
    is_dashed: true,
    is_filled: true,
  })
  expect(rects[1]).toMatchObject({
    is_dashed: false,
    is_filled: false,
  })
  expect(rects[2]).toMatchObject({
    is_dashed: false,
    is_filled: true,
  })

  expect(texts.map((t) => t.text)).toEqual([
    "Design Notes/Rev A",
    "Pin",
    "RESET",
  ])
  expect(texts[0]?.anchor).toBe("top_left")
  expect(texts[0]?.position.x).toBeCloseTo(
    rects[0]!.center.x - rects[0]!.width / 2,
    5,
  )
  expect(texts[0]?.position.y).toBeCloseTo(
    rects[0]!.center.y + rects[0]!.height / 2,
    5,
  )
  expect((texts[2] as { text_parts?: unknown })?.text_parts).toEqual([
    { text: "RESET", is_overlined: true },
  ])
})
