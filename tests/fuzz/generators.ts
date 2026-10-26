import fc from "fast-check"

export const modelArbitrary = fc.record({
  w: fc.integer({ min: 40, max: 160 }).map((n) => n / 10),
  h: fc.integer({ min: 30, max: 120 }).map((n) => n / 10),
  r: fc.integer({ min: 2, max: 10 }).map((n) => n / 10),
  x: fc.integer({ min: -100, max: 100 }),
  y: fc.integer({ min: -100, max: 100 }),
  bottom: fc.boolean(),
  text: fc
    .array(fc.constantFrom("a", "Z", "0", "µ", "Ω", " ", "_", "-"), {
      minLength: 1,
      maxLength: 12,
    })
    .map((x) => `Fuzz_${x.join("")}`),
})
export type Model =
  typeof modelArbitrary extends fc.Arbitrary<infer T> ? T : never
export const example: Model = {
  w: 8,
  h: 6,
  r: 0.5,
  x: 100,
  y: 100,
  bottom: false,
  text: "Fuzz_Ω",
}
export type Mode = "pcb" | "schematic" | "symbol" | "footprint"
const q = JSON.stringify
const stroke = "(stroke (width 0.15) (type default))"
const effects = "(effects (font (size 1 1)))"
export function footprint(m: Model, identity = true) {
  const side = m.bottom ? "B" : "F"
  return `(footprint "Fuzz:U" (layer "${side}.Cu") (at ${m.x} ${m.y})
    ${identity ? '(tstamp "11111111-1111-4111-8111-111111111111")' : ""}
    (fp_text reference "U1" (at 0 0) (layer "${side}.SilkS") ${effects})
    (fp_text user ${q(m.text)} (at 1 1) (layer "${side}.Fab") ${effects})
    (fp_text user ${q(m.text)} (at 2 2) (layer "${side}.Cu") ${effects})
    (pad "1" smd rect (at 0 0) (size ${m.r * 2} ${m.r * 3}) (layers "${side}.Cu" "${side}.Mask") (net 1 "NET_A"))
    (pad "2" thru_hole circle (at ${m.w} 0) (size ${m.r * 2} ${m.r * 2}) (drill ${m.r}) (layers "*.Cu" "*.Mask") (net 1 "NET_A"))
    (pad "" np_thru_hole circle (at 0 ${m.h}) (size ${m.r} ${m.r}) (drill ${m.r}) (layers "*.Cu" "*.Mask"))
    ${["SilkS", "Fab", "CrtYd"]
      .map(
        (layer) => `
      (fp_line (start 0 0) (end ${m.w} ${m.h}) ${stroke} (layer "${side}.${layer}"))
      (fp_rect (start 0 0) (end ${m.w} ${m.h}) ${stroke} (fill none) (layer "${side}.${layer}"))
      (fp_circle (center 0 0) (end ${m.r} 0) ${stroke} (fill none) (layer "${side}.${layer}"))`,
      )
      .join("\n")})`
}
export function pcb(m: Model) {
  const side = m.bottom ? "B" : "F"
  const pt = (x: number, y: number) => `${m.x + x} ${m.y + y}`
  const zone = `(pts (xy ${pt(-2, -2)}) (xy ${pt(m.w + 2, -2)}) (xy ${pt(m.w + 2, m.h + 2)}) (xy ${pt(-2, m.h + 2)}))`
  return `(kicad_pcb (version 20240108) (generator pcbnew)
    (general (thickness 1.6)) (paper "A4")
    (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (36 "B.SilkS" user "b.silkscreen") (37 "F.SilkS" user "f.silkscreen") (44 "Edge.Cuts" user) (46 "B.CrtYd" user) (47 "F.CrtYd" user) (48 "B.Fab" user) (49 "F.Fab" user))
    (net 0 "") (net 1 "NET_A")
    (gr_rect (start ${pt(-5, -5)}) (end ${pt(m.w + 5, m.h + 5)}) ${stroke} (fill none) (layer "Edge.Cuts"))
    (gr_rect (start ${pt(-4, -4)}) (end ${pt(-3, -3)}) ${stroke} (fill none) (layer "Edge.Cuts"))
    ${footprint(m)}
    (segment (start ${pt(0, 0)}) (end ${pt(m.w, 0)}) (width ${m.r / 2}) (layer "${side}.Cu") (net 1))
    (via (at ${pt(m.w / 2, 0)}) (size ${m.r * 2}) (drill ${m.r}) (layers "F.Cu" "B.Cu") (net 1))
    (zone (net 1) (net_name "NET_A") (layer "${side}.Cu") (hatch edge 0.5)
      (connect_pads (clearance .2)) (min_thickness .1) (fill yes (thermal_gap .3) (thermal_bridge_width .3))
      (polygon ${zone}) (filled_polygon (layer "${side}.Cu") ${zone})))`
}
export function symbol(m: Model) {
  return `(kicad_symbol_lib (version 20231120) (generator kicad_symbol_editor)
    (symbol "Fuzz" (in_bom yes) (on_board yes)
      (property "Reference" "U" (at 0 0 0) ${effects})
      (property "Value" ${q(m.text)} (at 0 1 0) ${effects})
      (symbol "Fuzz_0_1"
        (rectangle (start 0 0) (end ${m.w} ${m.h}) ${stroke} (fill (type none)))
        (circle (center 0 0) (radius ${m.r}) ${stroke} (fill (type none)))
        (arc (start ${m.r} 0) (mid 0 ${m.r}) (end ${-m.r} 0) ${stroke} (fill (type none)))
        (polyline (pts (xy 0 0) (xy ${m.w} ${m.h})) ${stroke} (fill (type none)))
        (polyline (pts (xy 0 0) (xy ${m.w} 0) (xy ${m.w} ${m.h}) (xy 0 0)) ${stroke} (fill (type background)))
        (text ${q(m.text)} (at 1 2 0) ${effects}))
      (symbol "Fuzz_1_1"
        (pin passive line (at 0 0 0) (length 1) (name "A" ${effects}) (number "1" ${effects}))
        (pin passive line (at ${m.w} 0 180) (length 1) (name "B" ${effects}) (number "2" ${effects})))))`
}
export function schematic(m: Model) {
  return `(kicad_sch (version 20231120) (generator eeschema)
    (uuid "22222222-2222-4222-8222-222222222222") (paper "A4") (lib_symbols)
    (text ${q(m.text)} (at ${m.x} ${m.y} 0) ${effects})
    (global_label ${q(m.text)} (shape input) (at ${m.x} ${m.y} 0) ${effects})
    (sheet (at ${m.x} ${m.y}) (size ${m.w} ${m.h}) ${stroke} (fill (color 0 0 0 0)) (uuid "33333333-3333-4333-8333-333333333333"))
    (rectangle (start ${m.x} ${m.y}) (end ${m.x + m.w} ${m.y + m.h}) ${stroke})
    (polyline (pts (xy ${m.x} ${m.y}) (xy ${m.x + m.w} ${m.y + m.h})) ${stroke})
    (arc (start ${m.x + m.r} ${m.y}) (mid ${m.x} ${m.y + m.r}) (end ${m.x - m.r} ${m.y}) ${stroke})
    (wire (pts (xy ${m.x} ${m.y}) (xy ${m.x + m.w} ${m.y})) ${stroke})
    (junction (at ${m.x + m.w} ${m.y}) (diameter 0) (color 0 0 0 0)))`
}
export const generate = { pcb, schematic, symbol, footprint }
