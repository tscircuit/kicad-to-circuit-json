// This file intentionally contains only the colors currently used in this repo.
// It is not a full KiCad theme export.
export const colorMap = {
  kicad: {
    schematic: {
      background: "rgb(245, 241, 237)",
      componentBody: "rgb(255, 255, 194)",
      componentOutline: "rgb(132, 0, 0)",
    },
  },
}

export const defaultSchematicStrokeColor =
  colorMap.kicad.schematic.componentOutline
export const defaultSchematicFillColor = colorMap.kicad.schematic.componentBody

export type ColorMap = typeof colorMap
