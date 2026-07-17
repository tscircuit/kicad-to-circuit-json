import type { FootprintPad } from "kicadts"

export type SupportedPadType = "smd" | "connect" | "thru_hole" | "np_thru_hole"

export function getSupportedPadType(pad: FootprintPad): SupportedPadType {
  switch (pad.padType) {
    case "smd":
    case "connect":
    case "thru_hole":
    case "np_thru_hole":
      return pad.padType
    default:
      return "thru_hole"
  }
}
