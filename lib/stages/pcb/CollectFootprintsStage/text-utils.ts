import type { Footprint } from "kicadts"
import type { NinePointAnchor } from "circuit-json"

/**
 * Gets a text value from a footprint by type (e.g., "reference", "value")
 */
export function getTextValue(
  footprint: Footprint,
  type: string,
): string | undefined {
  const texts = footprint.fpTexts || []
  const textArray = Array.isArray(texts) ? texts : [texts]
  const text = textArray.find((t: any) => t.type === type)
  return text?.text
}

/**
 * Gets a property value from a footprint by property name
 */
export function getPropertyValue(
  footprint: Footprint,
  propertyName: string,
): string | undefined {
  const properties = footprint.properties || []
  const propertyArray = Array.isArray(properties) ? properties : [properties]
  const property = propertyArray.find((p: any) => p.key === propertyName)
  return property?.value
}

/**
 * Substitutes KiCad variables (e.g., ${REFERENCE}, ${VALUE}) in text with actual values
 */
export function substituteKicadVariables(
  text: string,
  footprint: Footprint,
): string {
  let result = text

  // Get reference and value from properties
  const reference =
    getPropertyValue(footprint, "Reference") ||
    getTextValue(footprint, "reference") ||
    "?"
  const value =
    getPropertyValue(footprint, "Value") ||
    getTextValue(footprint, "value") ||
    ""

  // Replace KiCad variables
  result = result.replace(/\$\{REFERENCE\}/g, reference)
  result = result.replace(/\$\{VALUE\}/g, value)

  return result
}

/**
 * Maps KiCad text justification to Circuit JSON anchor alignment
 */
export function mapKicadJustifyToAnchorAlignment(
  justify: any,
): NinePointAnchor {
  if (!justify) return "center"

  const horizontal = justify.horizontal || "center"
  const vertical = justify.vertical || "center"

  if (vertical === "top") {
    if (horizontal === "left") return "top_left"
    if (horizontal === "center") return "top_center"
    if (horizontal === "right") return "top_right"
  }
  if (vertical === "center") {
    if (horizontal === "left") return "center_left"
    if (horizontal === "center") return "center"
    if (horizontal === "right") return "center_right"
  }
  if (vertical === "bottom") {
    if (horizontal === "left") return "bottom_left"
    if (horizontal === "center") return "bottom_center"
    if (horizontal === "right") return "bottom_right"
  }

  return "center"
}
