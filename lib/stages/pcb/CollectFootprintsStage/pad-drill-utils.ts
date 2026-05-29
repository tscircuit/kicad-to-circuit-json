export interface DrillDimensions {
  width: number
  height: number
  isOval: boolean
}

export function getDrillDimensions(drill: any): DrillDimensions {
  if (typeof drill !== "object" || drill === null) {
    const diameter = drill || 0.8
    return { width: diameter, height: diameter, isOval: false }
  }

  const isOval =
    drill._oval === true || drill.shape === "oval" || drill._shape === "oval"

  if (isOval) {
    return {
      // kicadts parses `(drill oval 0.9 2.1)` as `_diameter: 0.9, _width: 2.1`.
      width:
        drill.x ?? drill._diameter ?? drill.diameter ?? drill._width ?? 0.8,
      height: drill.y ?? drill._height ?? drill._width ?? drill.diameter ?? 0.8,
      isOval: true,
    }
  }

  const width = drill.x ?? drill._width ?? drill.diameter ?? 0.8
  return {
    width,
    height: drill.y ?? drill._height ?? drill.diameter ?? width,
    isOval: false,
  }
}
