import { expect, test } from "bun:test"
import { cju } from "@tscircuit/circuit-json-util"
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

  createSmdPad({
    ctx,
    pad: {
      number: "1",
      layers: ["F.Cu"],
      options: { anchor: "rect" },
      _sxPrimitives: {
        _graphics: [
          {
            token: "gr_poly",
            gr_poly: {
              _contours: [{ points: outerContour }, { points: holeContour }],
            },
          },
        ],
      },
    },
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
  const pad = {
    number: "1",
    padType: "smd",
    shape: "custom",
    at: { x: 0, y: 0, angle: 270 },
    size: { x: 0.001, y: 0.001 },
    layers: ["F.Cu"],
    _sxPrimitives: {
      _graphics: [
        {
          token: "gr_poly",
          gr_poly: {
            _contours: [
              {
                points: [
                  { x: 1, y: 0 },
                  { x: 0, y: 0 },
                ],
              },
            ],
          },
        },
      ],
    },
  }

  processPad({
    ctx,
    footprint: { fpPads: [pad] } as any,
    pad,
    componentId: "pcb_component_0",
    footprintPlacement: {
      kicadComponentPos: { x: 0, y: 0 },
      componentCcwRotationDegrees: 180,
    },
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
