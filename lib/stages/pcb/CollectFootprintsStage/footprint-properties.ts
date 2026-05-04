import type { Footprint } from "kicadts"

export function getFootprintProperties(footprint: Footprint): any[] {
  const properties = footprint.properties || []
  return Array.isArray(properties) ? properties : [properties]
}

export function getFootprintPropertyName(property: any): string | undefined {
  return property?.key ?? property?.name ?? property?._key
}

export function getFootprintPropertyValue(property: any): string | undefined {
  return property?.value ?? property?._value
}

export function findFootprintProperty(
  footprint: Footprint,
  propertyNames: string | string[],
): any | undefined {
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
