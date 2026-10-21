import { expect, test } from "bun:test"
import { generate, example } from "./generators"
import { importText, validate } from "./harness"

test("standalone duplicate physical pad numbers share one valid source port", () => {
  const input = generate.footprint(example).replace('(pad "2"', '(pad "1"')
  const { elements } = importText("footprint", input)
  validate(elements)
  expect(elements.filter((e) => e.type === "pcb_port")).toHaveLength(2)
  expect(elements.filter((e) => e.type === "source_port")).toHaveLength(1)
})
test("multiple fabrication text records receive distinct nonempty IDs", () => {
  const input = generate
    .footprint(example)
    .replace(
      /\)$/,
      `(fp_text user "second" (at 3 3) (layer "F.Fab") (effects (font (size 1 1)))))`,
    )
  const { elements } = importText("footprint", input)
  validate(elements)
  expect(
    elements.filter((e) => e.type === "pcb_fabrication_note_text"),
  ).toHaveLength(2)
})
test("board-level fabrication text preserves the schema-required unowned sentinel", () => {
  const input = generate
    .pcb(example)
    .replace(
      /\)$/,
      `(gr_text "board note" (at 100 100) (layer "F.Fab") (effects (font (size 1 1)))))`,
    )
  const { elements } = importText("pcb", input)
  validate(elements, { allowBoardGraphicSentinel: true })
  expect(
    elements.filter((e) => e.type === "pcb_fabrication_note_text"),
  ).toHaveLength(2)
  expect(elements.find((e) => e.text === "board note")!.pcb_component_id).toBe(
    "",
  )
})
