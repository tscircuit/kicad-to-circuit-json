import type { ConverterContext } from "../types"

/** Resolve a placed symbol's source identity, including repeated units. */
export function findSchematicSourceComponent(
  ctx: ConverterContext,
  { symbolUuid, reference }: { symbolUuid?: string; reference?: string },
) {
  const sourceIds = new Set<string>()
  for (const symbol of ctx.kicadSch?.symbols ?? []) {
    if (symbolUuid) {
      if (symbol.uuid !== symbolUuid) continue
    } else {
      if (!reference || reference.includes("?")) return undefined
      if (
        !symbol.properties.some(
          (p) => p.key === "Reference" && p.value === reference,
        )
      ) {
        continue
      }
    }
    const componentId =
      symbol.uuid && ctx.symbolUuidToComponentId?.get(symbol.uuid)
    const component = componentId
      ? ctx.db.schematic_component.get(componentId)
      : undefined
    if (component?.source_component_id)
      sourceIds.add(component.source_component_id)
  }
  if (sourceIds.size !== 1) return undefined
  return ctx.db.source_component.get([...sourceIds][0]!) ?? undefined
}
