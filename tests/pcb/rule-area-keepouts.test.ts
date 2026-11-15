import { expect, test } from "bun:test"
import { pcb_keepout } from "circuit-json"
import { KicadToCircuitJsonConverter } from "../../lib"

function importZones(zones: string) {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "rule-areas.kicad_pcb",
    `(kicad_pcb (version 20241229) (generator "pcbnew")
      (layers (0 "F.Cu" signal) (1 "In1.Cu" signal)
        (2 "In2.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
      (net 0 "")
      (gr_rect (start 0 0) (end 20 12)
        (stroke (width 0.1) (type solid)) (fill none) (layer "Edge.Cuts"))
      ${zones})`,
  )
  converter.runUntilFinished()
  return converter
}

const blockedRules = `(keepout (tracks not_allowed) (vias not_allowed)
  (pads not_allowed) (copperpour not_allowed) (footprints not_allowed))`
const rectangle = `(polygon (pts (xy 2 3) (xy 8 3) (xy 8 7) (xy 2 7)))`

test("preserves authored keepout geometry and explicit copper layers alongside fills", () => {
  const converter = importZones(`
    (zone (net 0) (net_name "") (layers "F.Cu" "In1.Cu" "B.Cu")
      (name "Placement exclusion") ${blockedRules} ${rectangle}
      (fill yes)
      (filled_polygon (layer "F.Cu")
        (pts (xy 3 4) (xy 4 4) (xy 4 5) (xy 3 5))))
    (zone (net 0) (net_name "") (layer "In2.Cu") (fill yes)
      (polygon (pts (xy 12 3) (xy 18 3) (xy 18 7) (xy 12 7))))`)
  const output = converter.getOutput()
  const keepouts = output.filter((element) => element.type === "pcb_keepout")
  expect(keepouts).toHaveLength(1)
  expect(pcb_keepout.parse(keepouts[0])).toMatchObject({
    shape: "rect",
    center: { x: -5, y: 1 },
    width: 6,
    height: 4,
    layers: ["top", "inner1", "bottom"],
    allow_traces: false,
    allow_placements: false,
    description: "Placement exclusion",
  })
  expect(
    output.filter((element) => element.type === "pcb_copper_pour"),
  ).toHaveLength(1)
  expect(converter.getWarnings()).toEqual([])
})

test.each([
  { zoneLayers: '(layer "In2.Cu")', expected: ["inner2"] },
  {
    zoneLayers: '(layers "*.Cu")',
    expected: ["top", "inner1", "inner2", "bottom"],
  },
])("maps rule-area layers $zoneLayers", ({ zoneLayers, expected }) => {
  const converter = importZones(
    `(zone ${zoneLayers} ${blockedRules} ${rectangle})`,
  )
  const keepout = converter
    .getOutput()
    .find((element) => element.type === "pcb_keepout")
  expect(keepout?.layers).toEqual([...expected])
})

test("partitions a concave filled area exactly without blocking its notch", () => {
  const converter = importZones(`(zone (layer "F.Cu") (name "L-shaped area")
    ${blockedRules}
    (polygon (pts (xy 2 2) (xy 10 2) (xy 10 4)
      (xy 4 4) (xy 4 8) (xy 2 8))))`)
  const keepouts = converter.getOutput().filter((e) => e.type === "pcb_keepout")
  expect(keepouts).toHaveLength(2)
  expect(keepouts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        shape: "rect",
        center: { x: -7, y: 0 },
        width: 2,
        height: 4,
      }),
      expect.objectContaining({
        shape: "rect",
        center: { x: -4, y: 3 },
        width: 8,
        height: 2,
      }),
    ]),
  )
  expect(converter.getWarnings()).toEqual([])
})

test("preserves holes instead of turning additional contours into blocked areas", () => {
  const converter = importZones(`(zone (layer "F.Cu") ${blockedRules}
    (polygon (pts (xy 2 2) (xy 18 2) (xy 18 10) (xy 2 10)))
    (polygon (pts (xy 6 4) (xy 14 4) (xy 14 8) (xy 6 8))))`)
  const keepouts = converter.getOutput().filter((e) => e.type === "pcb_keepout")
  expect(keepouts).toHaveLength(4)
  let area = 0
  for (const keepout of keepouts) {
    expect(pcb_keepout.safeParse(keepout).success).toBe(true)
    if (keepout.shape !== "rect")
      throw new Error("Expected rectangular partition")
    area += keepout.width * keepout.height
    const overlapsHole =
      Math.abs(keepout.center.x) < keepout.width / 2 + 4 &&
      Math.abs(keepout.center.y) < keepout.height / 2 + 2
    expect(overlapsHole).toBe(false)
  }
  expect(area).toBe(96)
  expect(converter.getWarnings()).toEqual([])
})

test("keeps equivalent winding, repeated vertices and collinear edges as one rectangle", () => {
  const converter = importZones(`(zone (layer "F.Cu") ${blockedRules}
    (polygon (pts (xy 2 3) (xy 2 5) (xy 2 7) (xy 8 7)
      (xy 8 7) (xy 8 3) (xy 2 3))))`)
  const keepouts = converter.getOutput().filter((e) => e.type === "pcb_keepout")
  expect(keepouts).toHaveLength(1)
  expect(keepouts[0]).toMatchObject({
    shape: "rect",
    center: { x: -5, y: 1 },
    width: 6,
    height: 4,
  })
  expect(converter.getWarnings()).toEqual([])
})

test.each([
  {
    name: "curved area",
    points: "(xy 6 6) (arc (start 6 6) (mid 10 2) (end 14 6)) (xy 14 6)",
    message: "curved boundaries",
  },
  {
    name: "skewed rectangle",
    points: "(xy 2 2) (xy 10 2.01) (xy 10 8) (xy 2 8)",
    message: "non-axis-aligned boundaries",
  },
  {
    name: "rotated rectangle",
    points: "(xy 2 6) (xy 6 2) (xy 10 6) (xy 6 10)",
    message: "non-axis-aligned boundaries",
  },
])(
  "reports $name without expanding or shrinking its exclusion",
  ({ name, points, message }) => {
    const converter = importZones(`(zone (layer "F.Cu") (name "${name}")
    ${blockedRules} (polygon (pts ${points})))`)
    expect(
      converter.getOutput().filter((e) => e.type === "pcb_keepout"),
    ).toHaveLength(0)
    expect(converter.getWarnings()).toHaveLength(1)
    expect(converter.getWarnings()[0]).toContain(message)
    expect(converter.getWarnings()[0]).toContain("not imported")
  },
)

test("does not fill an unsupported hole with a supported outer rectangle", () => {
  const converter = importZones(`(zone (layer "F.Cu") ${blockedRules}
    ${rectangle} (polygon (pts (xy 4 4) (xy 6 5) (xy 4 6))))`)
  expect(
    converter.getOutput().filter((e) => e.type === "pcb_keepout"),
  ).toHaveLength(0)
  expect(converter.getWarnings()[0]).toContain("non-axis-aligned boundaries")
})

test.each([
  {
    tracks: "allowed",
    vias: "not_allowed",
    pads: "allowed",
    footprints: "allowed",
    copperpour: "not_allowed",
  },
  {
    tracks: "allowed",
    vias: "allowed",
    pads: "not_allowed",
    footprints: "allowed",
    copperpour: "not_allowed",
  },
  {
    tracks: "not_allowed",
    vias: "not_allowed",
    pads: "not_allowed",
    footprints: "not_allowed",
    copperpour: "allowed",
  },
])(
  "reports unsupported independent restrictions instead of strengthening them: %j",
  (rules) => {
    const keepout = `(keepout ${Object.entries(rules)
      .map(([rule, value]) => `(${rule} ${value})`)
      .join(" ")})`
    const converter = importZones(
      `(zone (layer "F.Cu") ${keepout} ${rectangle})`,
    )
    expect(
      converter.getOutput().filter((e) => e.type === "pcb_keepout"),
    ).toHaveLength(0)
    expect(converter.getWarnings()[0]).toContain(
      "without changing their meaning",
    )
  },
)

test.each([
  { traces: true, placements: true },
  { traces: true, placements: false },
  { traces: false, placements: true },
  { traces: false, placements: false },
])("preserves representable permissions %j", ({ traces, placements }) => {
  const route = traces ? "allowed" : "not_allowed"
  const place = placements ? "allowed" : "not_allowed"
  const converter = importZones(`(zone (layer "F.Cu")
    (keepout (tracks ${route}) (vias ${route}) (pads ${place})
      (footprints ${place}) (copperpour not_allowed)) ${rectangle})`)
  const keepout = converter.getOutput().find((e) => e.type === "pcb_keepout")
  expect(pcb_keepout.parse(keepout)).toMatchObject({
    allow_traces: traces,
    allow_placements: placements,
  })
  expect(converter.getWarnings()).toEqual([])
})

test("uses KiCad defaults when legacy files omit pad and footprint rules", () => {
  const converter = importZones(`(zone (layer "F.Cu")
    (keepout (copperpour not_allowed)) ${rectangle})`)
  const keepout = converter.getOutput().find((e) => e.type === "pcb_keepout")
  expect(keepout).toMatchObject({ allow_traces: false, allow_placements: true })
  expect(converter.getWarnings()).toEqual([])
})

test("does not add blocking keepouts for zones with all operations allowed", () => {
  const converter = importZones(`(zone (layer "F.Cu")
    (keepout (tracks allowed) (vias allowed) (pads allowed)
      (copperpour allowed) (footprints allowed)) ${rectangle})`)
  expect(
    converter.getOutput().filter((element) => element.type === "pcb_keepout"),
  ).toHaveLength(0)
})

test("reports unsupported layers and degenerate polygons rather than inventing areas", () => {
  const converter = importZones(`
    (zone (layer "Edge.Cuts") (name "Mechanical area") ${blockedRules} ${rectangle})
    (zone (layer "F.Cu") (name "Flat area") ${blockedRules}
      (polygon (pts (xy 2 2) (xy 8 5) (xy 10 6))))`)
  expect(
    converter.getOutput().filter((element) => element.type === "pcb_keepout"),
  ).toHaveLength(0)
  expect(converter.getWarnings()).toEqual([
    'Rule area "Mechanical area": no supported copper layers; the keepout was not imported.',
    'Rule area "Flat area": a polygon has no area; the keepout was not imported.',
  ])
})

test("imports a circular rule area as a filled circle rather than its outline or bounds", () => {
  const converter = importZones(`(zone (layer "F.Cu") ${blockedRules}
    (polygon (pts (xy 6 6)
      (arc (start 6 6) (mid 10 2) (end 14 6))
      (arc (start 14 6) (mid 10 10) (end 6 6)) (xy 6 6))))`)
  const keepouts = converter.getOutput().filter((e) => e.type === "pcb_keepout")
  expect(keepouts).toHaveLength(1)
  expect(pcb_keepout.parse(keepouts[0])).toMatchObject({
    shape: "circle",
    center: { x: 0, y: 0 },
    radius: 4,
  })
  expect(converter.getWarnings()).toEqual([])
})

test("does not mistake arcs with different centers for a circular keepout", () => {
  const converter = importZones(`(zone (layer "F.Cu") ${blockedRules}
    (polygon (pts
      (arc (start 6 6) (mid 10 2) (end 14 6))
      (arc (start 14 6) (mid 10 8) (end 6 6)))))`)
  expect(
    converter.getOutput().filter((e) => e.type === "pcb_keepout"),
  ).toHaveLength(0)
  expect(converter.getWarnings()[0]).toContain("curved boundaries")
})
