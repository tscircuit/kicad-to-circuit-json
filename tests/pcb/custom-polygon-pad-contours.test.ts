import { expect, test } from "bun:test"
import { cju } from "@tscircuit/circuit-json-util"
import {
  Footprint,
  FootprintPad,
  PadOptions,
  PadPrimitiveGrPoly,
  PadPrimitives,
  Pts,
  Xy,
} from "kicadts"
import {
  createSmdPad,
  processPad,
} from "../../lib/stages/pcb/CollectFootprintsStage/process-pads"
import { isPointInsidePolygonContours } from "../../lib/stages/pcb/polygon-contours"

test("custom polygon pads preserve holes for trace endpoint matching", () => {
  const outerContour = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]
  const holeContour = [
    { x: 3, y: 3 },
    { x: 7, y: 3 },
    { x: 7, y: 7 },
    { x: 3, y: 7 },
  ]
  const contours = [outerContour, holeContour]

  expect(isPointInsidePolygonContours({ x: 1, y: 1 }, contours)).toBe(true)
  expect(isPointInsidePolygonContours({ x: 5, y: 5 }, contours)).toBe(false)
  expect(isPointInsidePolygonContours({ x: 3, y: 5 }, contours)).toBe(true)

  const circuitJson: any[] = []
  const ctx = {
    db: cju(circuitJson),
    k2cMatPcb: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    stats: {},
  } as any
  const polygonPrimitive = new PadPrimitiveGrPoly()
  polygonPrimitive.contours = [
    new Pts(outerContour.map(({ x, y }) => new Xy(x, y))),
    new Pts(holeContour.map(({ x, y }) => new Xy(x, y))),
  ]
  const primitives = new PadPrimitives()
  primitives.graphics = [polygonPrimitive]
  const options = new PadOptions()
  options.anchor = "rect"
  const pad = new FootprintPad({
    number: "1",
    padType: "smd",
    shape: "custom",
    size: [0.001, 0.001],
    layers: ["F.Cu"],
    options,
    primitives,
  })

  createSmdPad({
    ctx,
    pad,
    componentId: "pcb_component_0",
    pos: { x: 0, y: 0 },
    size: { x: 0.001, y: 0.001 },
    shape: "custom",
    pcbPortId: "pcb_port_0",
    sourcePortId: "source_port_0",
    padKicadPos: { x: 0, y: 0 },
  })

  const polygonPad = ctx.db.pcb_smtpad
    .list()
    .find((pad: any) => pad.shape === "polygon") as any

  expect(polygonPad.points).toHaveLength(8)
  expect(polygonPad.contours).toEqual(contours)
  expect(Object.keys(polygonPad)).not.toContain("contours")
  expect(JSON.parse(JSON.stringify(polygonPad)).contours).toBeUndefined()
})

test("custom pad polygons use the absolute KiCad pad rotation", () => {
  const circuitJson: any[] = []
  const ctx = {
    db: cju(circuitJson),
    k2cMatPcb: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    stats: {},
  } as any
  const polygonPrimitive = new PadPrimitiveGrPoly()
  polygonPrimitive.contours = [new Pts([new Xy(1, 0), new Xy(0, 0)])]
  const primitives = new PadPrimitives()
  primitives.graphics = [polygonPrimitive]
  const pad = new FootprintPad({
    number: "1",
    padType: "smd",
    shape: "custom",
    at: { x: 0, y: 0, angle: 270 },
    size: [0.001, 0.001],
    layers: ["F.Cu"],
    primitives,
  })

  processPad({
    ctx,
    footprint: new Footprint({ pads: [pad] }),
    pad,
    componentId: "pcb_component_0",
    footprintPlacement: {
      kicadComponentPos: { x: 0, y: 0 },
      componentCcwRotationDegrees: 180,
    },
    shouldCreatePorts: false,
  })

  const polygonPad = ctx.db.pcb_smtpad
    .list()
    .find((entry: any) => entry.shape === "polygon") as any

  // Board-level KiCad pad angles are already absolute. Negating 270° for the
  // KiCad-to-Circuit-JSON transform yields 90°; the 180° footprint rotation
  // must not be applied a second time.
  expect(polygonPad.points[0].x).toBeCloseTo(0)
  expect(polygonPad.points[0].y).toBeCloseTo(1)
})
