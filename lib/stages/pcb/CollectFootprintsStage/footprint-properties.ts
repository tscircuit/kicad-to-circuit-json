import type { Footprint, Property } from "kicadts"

export function getFootprintProperties(footprint: Footprint): Property[] {
  const properties = footprint.properties || []
  return Array.isArray(properties) ? properties : [properties]
}

export function getFootprintPropertyName(
  property: Property | undefined,
): string | undefined {
  return property?.key
}

export function getFootprintPropertyValue(
  property: Property | undefined,
): string | undefined {
  return property?.value
}

export function findFootprintProperty(
  footprint: Footprint,
  propertyNames: string | string[],
): Property | undefined {
  const names = Array.isArray(propertyNames) ? propertyNames : [propertyNames]

  return getFootprintProperties(footprint).find((property) =>
    names.includes(getFootprintPropertyName(property) ?? ""),
  )
}

export function findFootprintPropertyValue(
  footprint: Footprint,
  propertyNames: string | string[],
): string | undefined {
  const property = findFootprintProperty(footprint, propertyNames)
  return getFootprintPropertyValue(property)
}

export function parseSupplierPartNumbers(
  value: string | undefined,
): string[] | undefined {
  if (!value) return undefined

  const partNumbers = value
    .split(/[,;]/)
    .map((partNumber) => partNumber.trim())
    .filter(Boolean)

  return partNumbers.length > 0 ? partNumbers : undefined
}
