import { expect, test } from "bun:test"
import {
  doesDrcConnectivityAssertionMatchCircuitJson,
  getConnectivityIndex,
} from "./kicad-gencad-netlist"

test("KiCad DRC connectivity assertions validate every node pair", () => {
  const sameNetAssertion = {
    expectedRelation: "same-net",
    nodes: ["U1.1", "U2.1", "U3.1"],
  }
  const differentNetAssertion = {
    expectedRelation: "different-net",
    nodes: ["U1.1", "U2.1", "U3.1"],
  }

  const sameNetMissingThirdPad = getConnectivityIndex([
    ["U1.1", "U2.1"],
    ["U3.1"],
  ])
  const sameNetAllPadsConnected = getConnectivityIndex([
    ["U1.1", "U2.1", "U3.1"],
  ])
  const differentNetThirdPadShorted = getConnectivityIndex([
    ["U1.1"],
    ["U2.1", "U3.1"],
  ])
  const differentNetAllPadsSeparate = getConnectivityIndex([
    ["U1.1"],
    ["U2.1"],
    ["U3.1"],
  ])

  expect(
    doesDrcConnectivityAssertionMatchCircuitJson(
      sameNetAssertion,
      sameNetMissingThirdPad,
    ),
  ).toBe(false)
  expect(
    doesDrcConnectivityAssertionMatchCircuitJson(
      sameNetAssertion,
      sameNetAllPadsConnected,
    ),
  ).toBe(true)
  expect(
    doesDrcConnectivityAssertionMatchCircuitJson(
      differentNetAssertion,
      differentNetThirdPadShorted,
    ),
  ).toBe(false)
  expect(
    doesDrcConnectivityAssertionMatchCircuitJson(
      differentNetAssertion,
      differentNetAllPadsSeparate,
    ),
  ).toBe(true)
})
