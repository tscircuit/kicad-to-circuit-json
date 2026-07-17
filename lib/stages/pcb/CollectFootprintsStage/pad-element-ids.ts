import type { ConverterContext } from "../../../types"

function getNextUnusedId(usedIds: Set<string>, prefix: string): string {
  let index = usedIds.size
  let candidate = `${prefix}_${index}`

  while (usedIds.has(candidate)) {
    index += 1
    candidate = `${prefix}_${index}`
  }

  return candidate
}

export function getNextPcbSmtPadId(ctx: ConverterContext): string {
  const usedIds = new Set(
    ctx.db.pcb_smtpad.list().map((pad) => pad.pcb_smtpad_id),
  )

  return getNextUnusedId(usedIds, "pcb_smtpad")
}

export function getNextPcbPlatedHoleId(ctx: ConverterContext): string {
  const usedIds = new Set(
    ctx.db.pcb_plated_hole.list().map((hole) => hole.pcb_plated_hole_id),
  )

  return getNextUnusedId(usedIds, "pcb_plated_hole")
}
