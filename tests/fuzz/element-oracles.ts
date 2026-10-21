import { expect } from "bun:test"
import type { Mode, Model } from "./generators"
import { near, point, type Element } from "./harness"

// Expectations use the generator's semantic model, never converter helpers.
export function oracle(mode: Mode, type: string, m: Model, output: Element[]) {
  const all = output.filter((e) => e.type === type),
    e = all[0]!
  const counts: Record<string, number> = {
    pcb_port: 2,
    source_port: 2,
    schematic_port: 2,
    pcb_silkscreen_path: 2,
    pcb_fabrication_note_path: 2,
    schematic_line: 4,
  }
  expect(all).toHaveLength(
    type === "schematic_text" && mode === "symbol" ? 3 : (counts[type] ?? 1),
  )
  const pcb = (x: number, y: number) => ({
    x: x - (mode === "footprint" ? 0 : m.w / 2),
    y: -y + (mode === "footprint" ? 0 : m.h / 2),
  })
  const sch = (x: number, y: number) => ({
    x: (x - 105) / 15,
    y: (148.5 - y) / 15,
  })
  // This one-symbol library's pins span w × 0. The documented preview cell is
  // 10 × 9.5, 95% fill, with 7.5 units pin padding and a maximum scale of 1.
  const s = Math.min(1, 9.5 / (m.w + 7.5), 9.025 / 7.5)
  const sym = (x: number, y: number) => ({ x: -25 + x * s, y: y * s })
  const side = m.bottom ? "bottom" : "top"
  if (type.startsWith("pcb_") && e.layer) expect(e.layer).toBe(side)
  const size = (w: number, h: number) => {
    near(e.width, w)
    near(e.height, h)
  }
  switch (type) {
    case "source_component":
      expect(e.name).toBe(mode === "symbol" ? "Fuzz" : "U1")
      expect(e.ftype).toBe("simple_chip")
      break
    case "source_port":
      expect(all.map((p) => p.pin_number).sort()).toEqual([1, 2])
      expect(all.map((p) => p.name).sort()).toEqual(
        mode === "symbol" ? ["A", "B"] : ["pin1", "pin2"],
      )
      break
    case "source_net":
      expect(e.name).toBe(mode === "schematic" ? m.text : "NET_A")
      break
    case "source_trace": {
      const pins = output.filter((p) => p.type === "source_port")
      expect([...e.connected_source_port_ids].sort()).toEqual(
        pins.map((p) => p.source_port_id).sort(),
      )
      expect(e.connected_source_net_ids).toEqual([
        output.find((p) => p.type === "source_net")!.source_net_id,
      ])
      break
    }
    case "pcb_board":
      point(e.center, { x: 0, y: 0 })
      size(m.w + 10, m.h + 10)
      expect(e.num_layers).toBe(2)
      polygon(e.outline, [
        pcb(-5, -5),
        pcb(m.w + 5, -5),
        pcb(m.w + 5, m.h + 5),
        pcb(-5, m.h + 5),
      ])
      break
    case "pcb_component":
      point(e.center, pcb(0, 0))
      near(e.rotation, 0)
      break
    case "pcb_smtpad":
      point(e, pcb(0, 0))
      size(m.r * 2, m.r * 3)
      expect(e.shape).toBe("rect")
      break
    case "pcb_plated_hole":
      point(e, pcb(m.w, 0))
      near(e.hole_diameter, m.r)
      near(e.outer_diameter, m.r * 2)
      expect(e.layers).toEqual(["top", "bottom"])
      break
    case "pcb_hole":
      point(e, pcb(0, m.h))
      near(e.hole_diameter, m.r)
      expect(e.pcb_port_id).toBeUndefined()
      break
    case "pcb_port":
      point(all[0], pcb(0, 0))
      point(all[1], pcb(m.w, 0))
      expect(all[0]!.layers).toEqual([side])
      expect(all[1]!.layers).toEqual(["top", "bottom"])
      break
    case "pcb_via":
      point(e, pcb(m.w / 2, 0))
      near(e.hole_diameter, m.r)
      near(e.outer_diameter, m.r * 2)
      expect(e.layers).toEqual(["top", "bottom"])
      break
    case "pcb_trace":
      expect(e.route).toHaveLength(2)
      point(e.route[0], pcb(0, 0))
      point(e.route[1], pcb(m.w, 0))
      for (const v of e.route) {
        near(v.width, m.r / 2)
        expect(v.layer).toBe(side)
      }
      break
    case "pcb_copper_pour":
      expect(e.net_name).toBe("NET_A")
      polygon(e.points, [
        pcb(-2, -2),
        pcb(m.w + 2, -2),
        pcb(m.w + 2, m.h + 2),
        pcb(-2, m.h + 2),
      ])
      break
    case "pcb_cutout":
      polygon(e.points, [pcb(-4, -4), pcb(-3, -4), pcb(-3, -3), pcb(-4, -3)])
      break
    case "pcb_courtyard_circle":
    case "pcb_silkscreen_circle":
      point(e.center, pcb(0, 0))
      near(e.radius, m.r)
      break
    case "pcb_courtyard_rect":
    case "pcb_fabrication_note_rect":
      point(e.center, pcb(m.w / 2, m.h / 2))
      size(m.w, m.h)
      break
    case "pcb_courtyard_outline":
      expect(e.outline).toHaveLength(2)
      point(e.outline[0], pcb(0, 0))
      point(e.outline[1], pcb(m.w, m.h))
      break
    case "pcb_silkscreen_path":
    case "pcb_fabrication_note_path":
      expect(e.route).toHaveLength(2)
      point(e.route[0], pcb(0, 0))
      point(e.route[1], pcb(m.w, m.h))
      near(e.stroke_width, 0.15)
      if (type === "pcb_silkscreen_path")
        polygon(all[1]!.route, [
          pcb(0, 0),
          pcb(m.w, 0),
          pcb(m.w, m.h),
          pcb(0, m.h),
        ])
      else {
        const c = pcb(0, 0)
        expect(all[1]!.route.length).toBeGreaterThan(4)
        for (const p of all[1]!.route)
          near(Math.hypot(p.x - c.x, p.y - c.y), m.r)
      }
      break
    case "pcb_silkscreen_text":
      expect(e.text).toBe("U1")
      point(e.anchor_position, pcb(0, 0))
      break
    case "pcb_fabrication_note_text":
      expect(e.text).toBe(m.text)
      point(e.anchor_position, pcb(1, 1))
      break
    case "pcb_copper_text":
      expect(e.text).toBe(m.text)
      point(e.anchor_position, pcb(2, 2))
      break
    case "schematic_symbol":
      expect(e.name).toBe("Fuzz")
      break
    case "schematic_component":
      point(e.center, sym(0, 0))
      expect(e.symbol_display_value).toBe(m.text)
      break
    case "schematic_port":
      point(all[0]!.center, sym(0, 0))
      point(all[1]!.center, sym(m.w, 0))
      expect(all.map((p) => p.pin_number)).toEqual([1, 2])
      break
    case "schematic_circle":
      point(e.center, sym(0, 0))
      near(e.radius, m.r * s)
      break
    case "schematic_line":
      point({ x: e.x1, y: e.y1 }, sym(0, 0))
      point({ x: e.x2, y: e.y2 }, sym(m.w, m.h))
      near(e.stroke_width, 0.15 * s)
      break
    case "schematic_rect":
      if (mode === "symbol") {
        point(e.center, sym(m.w / 2, m.h / 2))
        size(m.w * s, m.h * s)
      } else {
        point(e.center, sch(m.x + m.w / 2, m.y + m.h / 2))
        size(m.w / 15, m.h / 15)
      }
      break
    case "schematic_arc":
      point(e.center, mode === "symbol" ? sym(0, 0) : sch(m.x, m.y))
      near(e.radius, m.r * (mode === "symbol" ? s : 1 / 15))
      near(((e.start_angle_degrees + 540) % 360) - 180, 0, 5)
      near(((e.end_angle_degrees - 180 + 540) % 360) - 180, 0, 5)
      expect(e.direction).toBe(
        mode === "symbol" ? "counterclockwise" : "clockwise",
      )
      break
    case "schematic_path":
      if (mode === "symbol") {
        polygon(e.points, [sym(0, 0), sym(m.w, 0), sym(m.w, m.h)])
        expect(e.is_filled).toBe(true)
      } else {
        expect(e.points).toHaveLength(2)
        point(e.points[0], sch(m.x, m.y))
        point(e.points[1], sch(m.x + m.w, m.y + m.h))
      }
      break
    case "schematic_box":
      point(e, sch(m.x, m.y + m.h))
      size(m.w / 15, m.h / 15)
      break
    case "schematic_net_label":
      expect(e.text).toBe(m.text)
      point(e.center, sch(m.x, m.y))
      expect(e.anchor_side).toBe("left")
      break
    case "schematic_text":
      expect(e.text).toBe(m.text)
      point(e.position, mode === "symbol" ? sym(1, 2) : sch(m.x, m.y))
      expect(e.anchor).toBe("center")
      break
    case "schematic_trace":
      expect(e.edges).toHaveLength(1)
      point(e.edges[0].from, sch(m.x, m.y))
      point(e.edges[0].to, sch(m.x + m.w, m.y))
      expect(e.junctions).toHaveLength(1)
      point(e.junctions[0], sch(m.x + m.w, m.y))
      break
    default:
      throw new Error(`No semantic oracle for ${mode}:${type}`)
  }
}
function polygon(actual: any[], expected: { x: number; y: number }[]) {
  const points = [...actual]
  if (points.length === expected.length + 1) {
    point(points.at(-1), points[0])
    points.pop()
  }
  expect(points).toHaveLength(expected.length)
  // Ignore winding and starting vertex; retain every vertex, including concavity.
  const key = (p: any) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`
  expect(points.map(key).sort()).toEqual(expected.map(key).sort())
}
