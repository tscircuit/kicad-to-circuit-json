import { cjuIndexed } from "@tscircuit/circuit-json-util"

export const createConverterDb = () =>
  cjuIndexed([], { indexConfig: { byId: true, byType: true } })
