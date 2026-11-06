import { describe, expect, test } from "bun:test"
import type { Footprint } from "kicadts"
import { getFootprintReference } from "../lib/stages/pcb/CollectFootprintsStage/footprint-properties"
import { getChamferedPadPoints } from "../lib/stages/pcb/CollectFootprintsStage/get-chamfered-pad-points"
import {
  getRightAngleTurns,
  normalizeRotationDegrees,
} from "../lib/stages/pcb/CollectFootprintsStage/pad-rotation"
import { inferSymbolName } from "../lib/stages/schematic/utils/inferSymbolName"
import { rotationToDirection } from "../lib/stages/schematic/utils/rotationToDirection"

describe("inferSymbolName, rotationToDirection, pad-rotation, chamfer, and footprint-properties helpers", () => {
  test("inferSymbolName classifies Device:LED with LED reference as led instead of inductor and avoids false positives on connectors/crystals/relays", () => {
    expect(
      inferSymbolName({
        libId: "Device:LED",
        reference: "LED1",
        rotation: 0,
      }),
    ).toBe("led_up")

    expect(
      inferSymbolName({
        libId: "Device:L",
        reference: "L1",
        rotation: 90,
      }),
    ).toBe("inductor_right")

    expect(
      inferSymbolName({
        libId: "Device:CP",
        reference: "C1",
        rotation: 180,
      }),
    ).toBe("capacitor_down")

    expect(
      inferSymbolName({
        libId: "Connector:Conn_01x04",
        reference: "C1",
        rotation: 0,
      }),
    ).toBeUndefined()

    expect(
      inferSymbolName({
        libId: "Device:Crystal",
        reference: "C2",
        rotation: 0,
      }),
    ).toBeUndefined()

    expect(
      inferSymbolName({
        libId: "Relay:Relay_SPDT",
        reference: "R1",
        rotation: 0,
      }),
    ).toBeUndefined()
  })

  test("rotationToDirection falls back non-finite rotations to up", () => {
    expect(rotationToDirection(Number.NaN)).toBe("up")
    expect(rotationToDirection(Number.POSITIVE_INFINITY)).toBe("up")
    expect(rotationToDirection(-90)).toBe("left")
  })

  test("normalizeRotationDegrees and getRightAngleTurns handle non-finite rotations and avoid -0", () => {
    expect(normalizeRotationDegrees(Number.NaN)).toBe(0)
    expect(normalizeRotationDegrees(Number.POSITIVE_INFINITY)).toBe(0)
    expect(Object.is(normalizeRotationDegrees(-360), 0)).toBe(true)

    expect(getRightAngleTurns(Number.NaN)).toBeNull()
    expect(getRightAngleTurns(Number.POSITIVE_INFINITY)).toBeNull()
    expect(Object.is(getRightAngleTurns(-0), 0)).toBe(true)
    expect(getRightAngleTurns(180)).toBe(2)
    expect(getRightAngleTurns(45)).toBeNull()
  })

  test("getChamferedPadPoints clamps ratios to [0, 0.5] and deduplicates meeting vertices at 0.5 chamfer", () => {
    const diamondPoints = getChamferedPadPoints({
      width: 2,
      height: 2,
      chamferRatio: 0.5,
      chamferCorners: ["top_left", "top_right", "bottom_right", "bottom_left"],
      roundrectRatio: 0,
    })

    expect(diamondPoints).toHaveLength(4)

    const clampedPoints = getChamferedPadPoints({
      width: 2,
      height: 2,
      chamferRatio: 1.5,
      chamferCorners: ["top_left", "top_right", "bottom_right", "bottom_left"],
      roundrectRatio: -0.25,
    })

    expect(clampedPoints).toEqual(diamondPoints)
  })

  test("getFootprintReference ignores whitespace-only Reference property and falls back to fpTexts reference", () => {
    const footprint = {
      properties: [{ key: "Reference", value: "   " }],
      fpTexts: [{ type: "reference", text: " U1 " }],
    } as unknown as Footprint

    expect(getFootprintReference(footprint)).toBe("U1")
  })
})
