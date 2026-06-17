type SharpColor = {
  r: number
  g: number
  b: number
  alpha: number
}

const sharpColor = (
  r: number,
  g: number,
  b: number,
  alpha = 1,
): SharpColor => ({
  r,
  g,
  b,
  alpha,
})

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
  snapshots: {
    label: {
      background: "black",
      text: "white",
    },
    diffHighlight: "#ff00ff",
    sharp: {
      black: sharpColor(0, 0, 0),
      white: sharpColor(255, 255, 255),
      kicadSchematicBackground: sharpColor(245, 241, 237),
      transparentKicadSchematicBackground: sharpColor(245, 241, 237, 0),
    },
  },
  debug: {
    viaOverlay: {
      routeStroke: "#00ff66",
      unconnectedFill: "rgba(255,0,0,0.18)",
      unconnectedStroke: "#ff1744",
      unconnectedLabel: "#ff5a76",
      onTraceFill: "rgba(255,176,0,0.16)",
      onTraceStroke: "#ffb000",
      onTraceLabel: "#ffcf57",
      panelFill: "rgba(0,0,0,0.72)",
      panelStroke: "#ffffff",
    },
  },
}

export const defaultSchematicStrokeColor =
  colorMap.kicad.schematic.componentOutline
export const defaultSchematicFillColor = colorMap.kicad.schematic.componentBody

export type ColorMap = typeof colorMap
