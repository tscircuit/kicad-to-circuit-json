import { expect, test } from "bun:test"
import "bun-match-svg"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { KicadToCircuitJsonConverter } from "../../lib"

type Point = { x: number; y: number }
const rectangle = [
  { x: -0.93, y: -0.47 },
  { x: 0.93, y: -0.47 },
  { x: 0.93, y: 0.47 },
  { x: -0.93, y: 0.47 },
]
const lines = (points: Point[], layer = "F.CrtYd", closed = true) =>
  points.slice(0, closed ? points.length : -1).map((a, i) => {
    const b = points[(i + 1) % points.length]!
    return `(fp_line (start ${a.x} ${a.y}) (end ${b.x} ${b.y})
      (stroke (width 0.05) (type solid)) (layer "${layer}"))`
  })
const convert = (graphics: string[], angle = 90, layer = "F.Cu") => {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "courtyard.kicad_pcb",
    `(kicad_pcb
    (version 20240108) (generator "pcbnew") (general (thickness 1.6))
    (layers (0 "F.Cu" signal) (31 "B.Cu" signal)
      (46 "B.CrtYd" user) (47 "F.CrtYd" user))
    (footprint "CourtyardRepro" (layer "${layer}")
      (uuid "10000000-0000-4000-8000-000000000001") (at 141.91 102.91 ${angle})
      (property "Reference" "U1" (at 0 -2) (layer "F.SilkS"))
      (pad "1" smd circle (at 0 0) (size 0.3 0.3) (layers "${layer}"))
      ${graphics.join("\n")}))`,
  )
  converter.runUntilFinished()
  return {
    converter,
    outlines: converter
      .getOutput()
      .filter((e) => e.type === "pcb_courtyard_outline"),
  }
}
const area = (points: Point[]) =>
  Math.abs(
    points.reduce((sum, p, i) => {
      const q = points[(i + 1) % points.length]!
      return sum + p.x * q.y - p.y * q.x
    }, 0) / 2,
  )

// C13 in OrangeCrab r0.2.1 has these courtyard dimensions, represented by
// four separate fp_line records. This board is a minimal authored reduction.
for (const angle of [0, 33, 90, 270]) {
  test.failing(`joins the OrangeCrab C13 courtyard at ${angle} degrees`, () => {
    const { outlines } = convert(lines(rectangle), angle)
    expect(outlines).toHaveLength(1)
    expect(area(outlines[0]!.outline)).toBeCloseTo(1.86 * 0.94, 8)
    expect(outlines[0]!.layer).toBe("top")
  })
}

test.failing("keeps the front and back courtyard contours separate", () => {
  const { outlines } = convert([
    ...lines(rectangle),
    ...lines(rectangle, "B.CrtYd"),
  ])
  expect(outlines).toHaveLength(2)
  expect(outlines.map((e) => e.layer).sort()).toEqual(["bottom", "top"])
  for (const outline of outlines)
    expect(area(outline.outline)).toBeCloseTo(1.7484, 8)
})

test.failing("joins shuffled and reversed edges on a bottom footprint", () => {
  const edges = lines([...rectangle].reverse(), "B.CrtYd")
  const { outlines } = convert(
    [edges[2]!, edges[0]!, edges[3]!, edges[1]!],
    90,
    "B.Cu",
  )
  expect(outlines).toHaveLength(1)
  expect(outlines[0]!.layer).toBe("bottom")
  expect(area(outlines[0]!.outline)).toBeCloseTo(1.7484, 8)
})

test.failing("preserves two disjoint courtyards", () => {
  const second = rectangle.map((p) => ({ x: p.x + 3, y: p.y }))
  const { outlines } = convert([...lines(rectangle), ...lines(second)])
  expect(outlines).toHaveLength(2)
  for (const outline of outlines)
    expect(area(outline.outline)).toBeCloseTo(1.7484, 8)
})

test.failing("joins an arc and line into one courtyard", () => {
  const { outlines } = convert([
    '(fp_arc (start -1 0) (mid 0 -1) (end 1 0) (stroke (width 0.05) (type solid)) (layer "F.CrtYd"))',
    '(fp_line (start 1 0) (end -1 0) (stroke (width 0.05) (type solid)) (layer "F.CrtYd"))',
  ])
  expect(outlines).toHaveLength(1)
  expect(outlines[0]!.outline.length).toBeGreaterThan(10)
  expect(area(outlines[0]!.outline)).toBeCloseTo(Math.PI / 2, 2)
})

for (const [name, graphics] of [
  ["open", lines(rectangle, "F.CrtYd", false)],
  [
    "collinear",
    lines([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]),
  ],
  [
    "self-intersecting",
    lines([
      { x: 0, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
      { x: 2, y: 0 },
    ]),
  ],
  [
    "branched",
    [
      ...lines(rectangle),
      '(fp_line (start 0.93 0.47) (end 2 2) (stroke (width 0.05) (type solid)) (layer "F.CrtYd"))',
    ],
  ],
] as const) {
  test.failing(`warns and omits ${name} courtyard chains`, () => {
    const { converter, outlines } = convert([...graphics])
    expect(outlines).toHaveLength(0)
    expect(
      converter.ctx?.warnings?.some((w) => /courtyard/i.test(w)),
    ).toBeTrue()
  })
}

test("retains explicit courtyard polygons", () => {
  const { outlines } = convert([
    '(fp_poly (pts (xy -1 -1) (xy 1 -1) (xy 1 1) (xy -1 1)) (stroke (width 0.05) (type solid)) (fill none) (layer "F.CrtYd"))',
  ])
  expect(outlines).toHaveLength(1)
  expect(area(outlines[0]!.outline)).toBeCloseTo(4, 8)
})

test("renders imported OrangeCrab courtyard outlines", async () => {
  const { converter, outlines } = convert(lines(rectangle), 0)
  const board = converter.getOutput().find((e) => e.type === "pcb_component")
  if (!board) throw new Error("Missing courtyard component")
  const pcb = convertCircuitJsonToPcbSvg(converter.getOutput(), {
    width: 600,
    height: 300,
    includeVersion: false,
    showCourtyards: true,
    viewport: {
      minX: board.center.x - 1.3,
      maxX: board.center.x + 1.3,
      minY: board.center.y - 0.8,
      maxY: board.center.y + 0.8,
    },
  })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360" viewBox="0 0 600 360"><rect width="600" height="360" fill="#111827"/><text x="16" y="24" fill="white" font-family="sans-serif" font-size="16">C13: ${outlines.length} imported courtyard outlines</text><text x="16" y="48" fill="white" font-family="sans-serif" font-size="14">Vertices per outline: ${outlines.map((e) => e.outline.length).join(", ")} · expected: one closed rectangle</text><svg x="0" y="60" width="600" height="300">${pcb.replace(/^.*?<svg[^>]*>/s, "").replace(/<\/svg>\s*$/, "")}</svg></svg>`
  await expect(svg).toMatchSvgSnapshot(
    import.meta.path,
    "orangecrab-courtyard-contours",
  )
})
