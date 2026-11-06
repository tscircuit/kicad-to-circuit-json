import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import type { SourcePort } from "circuit-json"

export function getSourcePortPinNumber(port: SourcePort): string | undefined {
  const rawNumber = port.port_hints?.find((hint) => /^\d+$/.test(hint))
  if (rawNumber) return rawNumber
  return port.pin_number !== undefined
    ? String(port.pin_number)
    : port.port_hints?.[0]
}

export function sourcePortMatchesPin(port: SourcePort, pinNumber: string) {
  if (!pinNumber) return false
  return (
    getSourcePortPinNumber(port) === pinNumber ||
    port.port_hints?.includes(pinNumber) === true
  )
}

/** Create terminals independently of whether they have a net assignment. */
export function getOrCreateSourcePort({
  db,
  sourceComponentId,
  pinNumber,
  name,
  sourcePortId,
  doNotConnect,
}: {
  db: CircuitJsonUtilObjects
  sourceComponentId: string
  pinNumber: string
  name: string
  sourcePortId?: string
  doNotConnect?: boolean
}): SourcePort {
  const existing = sourcePortId
    ? db.source_port.get(sourcePortId)
    : db.source_port
        .list({ source_component_id: sourceComponentId })
        .find((port) => sourcePortMatchesPin(port, pinNumber))
  if (existing) {
    if (doNotConnect) {
      return db.source_port.update(existing.source_port_id, {
        do_not_connect: true,
      })
    }
    return existing
  }
  return db.source_port.insert({
    ...(sourcePortId ? { source_port_id: sourcePortId } : {}),
    source_component_id: sourceComponentId,
    name,
    ...(/^\d+$/.test(pinNumber)
      ? {
          pin_number: Number(pinNumber),
          ...(String(Number(pinNumber)) !== pinNumber
            ? { port_hints: [pinNumber] }
            : {}),
        }
      : { port_hints: pinNumber ? [pinNumber] : [] }),
    ...(doNotConnect ? { do_not_connect: true } : {}),
  })
}
