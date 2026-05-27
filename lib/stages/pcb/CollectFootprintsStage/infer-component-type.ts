import type { Footprint } from "kicadts"
import { findFootprintPropertyValue } from "./footprint-properties"

type StringValued = { value: string }

/**
 * Infers the component type (ftype) from the reference designator.
 */
export function inferComponentType(
  reference: string | undefined,
  footprint?: Footprint,
): string {
  if (!reference && !footprint) return "simple_chip"

  const normalizedReference = reference?.trim()
  const prefix = normalizedReference?.match(/^([A-Z]+)/)?.[1]

  if (
    isFiducialReference(normalizedReference) ||
    isFiducialFootprint(footprint)
  ) {
    return "simple_fiducial"
  }

  switch (prefix) {
    case "R":
      return "simple_resistor"
    case "C":
      return "simple_capacitor"
    case "L":
      return "simple_inductor"
    case "D":
      return "simple_diode"
    case "LED":
      return "simple_diode"
    case "Q":
      // Q* is a generic transistor designator; actual transistor
      // polarity (npn/pnp) is determined later from the footprint
      // or library information via inferTransistorTypeFromFootprint.
      return "simple_transistor"
    case "U":
    case "IC":
      return "simple_chip"
    case "J":
    case "P":
      return "simple_chip" // Connectors treated as chips
    default:
      return "simple_chip"
  }
}

function isFiducialReference(reference: string | undefined): boolean {
  return /^FID\d+/i.test(reference || "")
}

function isFiducialFootprint(footprint: Footprint | undefined): boolean {
  if (!footprint) return false

  const metadata = [
    footprint.libraryLink,
    getSxStringValue(footprint.descr),
    getSxStringValue(footprint.tags),
    findFootprintPropertyValue(footprint, "Footprint"),
    findFootprintPropertyValue(footprint, "Description"),
    findFootprintPropertyValue(footprint, "Value"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  return metadata.includes("fiducial")
}

function getSxStringValue(
  value: StringValued | string | undefined,
): string | undefined {
  if (!value) return undefined
  if (typeof value === "string") return value
  return value.value
}

/**
 * Best-effort inference of transistor_type ("npn" | "pnp") for
 * simple_transistor source components.
 *
 * For now we only look at the footprint value and properties and
 * fall back to "npn" when we can't confidently determine the type.
 */
export function inferTransistorTypeFromFootprint(
  footprint: Footprint,
  value: string | undefined,
): "npn" | "pnp" {
  const lowerValue = (value || "").toLowerCase()

  // Common naming conventions in KiCad libraries
  if (lowerValue.includes("pnp")) return "pnp"
  if (lowerValue.includes("npn")) return "npn"

  // Look at the footprint's library id if available
  const libId = (footprint as any).libraryId as string | undefined
  const lowerLibId = (libId || "").toLowerCase()

  if (lowerLibId.includes("pnp")) return "pnp"
  if (lowerLibId.includes("npn")) return "npn"

  // Default to npn as a sensible fallback
  return "npn"
}
