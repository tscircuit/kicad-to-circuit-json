import { expect, test } from "bun:test"
import { getChamferedPadPoints } from "../../lib/stages/pcb/CollectFootprintsStage/get-chamfered-pad-points"

test("chamfered pads keep the other corners rounded", () => {
  for (const name of ["top_left", "top_right", "bottom_right", "bottom_left"]) {
    const points = getChamferedPadPoints({
      width: 4,
      height: 2,
      chamferRatio: 0.25,
      chamferCorners: [name],
      roundrectRatio: 0.2,
    })
    const area =
      Math.abs(
        points.reduce((sum, point, index) => {
          const next = points[(index + 1) % points.length]!
          return sum + point.x * next.y - next.x * point.y
        }, 0),
      ) / 2
    // Remove one 0.5 mm right triangle and three radius-0.4 rounded corners.
    const exactArea = 8 - 0.5 ** 2 / 2 - 3 * 0.4 ** 2 * (1 - Math.PI / 4)
    // The existing arc approximation uses at least eight segments per corner.
    expect(Math.abs(area - exactArea)).toBeLessThan(0.003)
    expect(Math.min(...points.map((p) => p.x))).toBeCloseTo(-2, 8)
    expect(Math.max(...points.map((p) => p.x))).toBeCloseTo(2, 8)
    expect(Math.min(...points.map((p) => p.y))).toBeCloseTo(-1, 8)
    expect(Math.max(...points.map((p) => p.y))).toBeCloseTo(1, 8)
  }
})
