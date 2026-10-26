import type { LayerRef, PcbCopperPourBRep } from "circuit-json"
import type { ConverterContext, Point } from "../../types"

function createCircularRing(
  center: Point,
  radius: number,
  clockwise: boolean,
): PcbCopperPourBRep["brep_shape"]["outer_ring"] {
  const direction = clockwise ? -1 : 1
  // bulge = tan(sweep / 4): four exact quarter-circle arcs.
  const bulge = direction * Math.tan(Math.PI / 8)
  return {
    vertices: [
      { x: center.x + radius, y: center.y, bulge },
      { x: center.x, y: center.y + direction * radius, bulge },
      { x: center.x - radius, y: center.y, bulge },
      { x: center.x, y: center.y - direction * radius, bulge },
    ],
  }
}

/** Preserve a circular copper graphic's physical area, including its open center. */
export function createCopperCircle(params: {
  ctx: ConverterContext
  center: Point
  radius: number
  strokeWidth: number
  isFilled: boolean
  layer: LayerRef
}) {
  const { ctx, center, radius, strokeWidth, isFilled, layer } = params
  if (
    ![center.x, center.y, radius, strokeWidth].every(Number.isFinite) ||
    radius < 0 ||
    strokeWidth < 0 ||
    (!isFilled && strokeWidth === 0)
  ) {
    return
  }

  const outerRadius = radius + strokeWidth / 2
  if (outerRadius <= 0) return
  const innerRadius = radius - strokeWidth / 2
  const copperCircle: Omit<PcbCopperPourBRep, "type" | "pcb_copper_pour_id"> = {
    shape: "brep",
    layer,
    covered_with_solder_mask: true,
    brep_shape: {
      outer_ring: createCircularRing(center, outerRadius, true),
      inner_rings:
        !isFilled && innerRadius > 0
          ? [createCircularRing(center, innerRadius, false)]
          : [],
    },
  }
  ctx.db.pcb_copper_pour.insert(copperCircle)
  if (ctx.stats) {
    ctx.stats.copper_pours = (ctx.stats.copper_pours ?? 0) + 1
  }
}
