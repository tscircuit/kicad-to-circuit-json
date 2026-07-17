import { expect, test } from "bun:test"
import { FootprintPad } from "kicadts"
import { orderOverlappingFootprintPads } from "../../lib/stages/pcb/CollectFootprintsStage/order-overlapping-footprint-pads"

test("orders custom copper before overlapping plated holes with the same number", () => {
  const distantOrdinaryPad = new FootprintPad({
    number: "SH",
    padType: "thru_hole",
    shape: "oval",
    at: { x: 5, y: 5 },
    size: [1, 1.55],
  })
  const overlappingOrdinaryPad = new FootprintPad({
    number: "SH",
    padType: "thru_hole",
    shape: "oval",
    at: { x: 0.33, y: 0.6 },
    size: [1, 1.55],
  })
  const customPad = new FootprintPad({
    number: "SH",
    padType: "thru_hole",
    shape: "custom",
    at: { x: 0, y: 0 },
    size: [1.2, 1.2],
  })
  const sourceOrder = [distantOrdinaryPad, overlappingOrdinaryPad, customPad]

  expect(orderOverlappingFootprintPads(sourceOrder)).toEqual([
    distantOrdinaryPad,
    customPad,
    overlappingOrdinaryPad,
  ])
  expect(sourceOrder).toEqual([
    distantOrdinaryPad,
    overlappingOrdinaryPad,
    customPad,
  ])
})

test("preserves unrelated pad order", () => {
  const firstPad = new FootprintPad({
    number: "1",
    padType: "thru_hole",
    shape: "oval",
    at: { x: 0, y: 0 },
    size: [1, 1],
  })
  const differentNumberCustomPad = new FootprintPad({
    number: "2",
    padType: "thru_hole",
    shape: "custom",
    at: { x: 0, y: 0 },
    size: [1, 1],
  })

  expect(
    orderOverlappingFootprintPads([firstPad, differentNumberCustomPad]),
  ).toEqual([firstPad, differentNumberCustomPad])
})
