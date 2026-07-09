import { expect, test } from "bun:test"
import { upgradeKicad5FootprintToKicad6 } from "../lib/kicad5/upgradeKicad5FootprintToKicad6"

test("kicad5 upgrader: rewrites legacy module-root footprints to footprint root", () => {
  const upgraded = upgradeKicad5FootprintToKicad6(
    `(module LegacyFootprint (layer F.Cu)
      (fp_text reference REF** (at 0 -1.5) (layer F.SilkS))
    )`,
  )

  expect(upgraded.startsWith("(footprint LegacyFootprint")).toBe(true)
  expect(upgraded.includes("(module LegacyFootprint")).toBe(false)
})
