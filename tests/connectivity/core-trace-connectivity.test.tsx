import { expect, test } from "bun:test"
import { RootCircuit } from "@tscircuit/core"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import React from "react"

test("connectivity map links pcb traces to pcb ports", async () => {
  const circuit = new RootCircuit()

  circuit.add(
    <board width="20mm" height="20mm">
      <resistor name="R1" resistance="10k" footprint="0402" />
      <capacitor
        name="C1"
        capacitance="100nF"
        footprint="axial"
        connections={{
          pin1: "R1.pin2",
          pin2: "R1.pin1",
        }}
      />
    </board>,
  )

  await circuit.renderUntilSettled()
  const circuitJson = circuit.getCircuitJson()
  const connectivityMap = getFullConnectivityMapFromCircuitJson(
    circuitJson as any,
  )

  const pcbTraces = (circuitJson as any[]).filter(
    (el) => el.type === "pcb_trace",
  )
  expect(pcbTraces.length).toBeGreaterThan(1)

  const trace0 = pcbTraces[0]
  const trace1 = pcbTraces[1]
  expect(trace0.pcb_trace_id).toBeDefined()
  expect(trace1.pcb_trace_id).toBeDefined()

  const trace0StartPort = trace0.route.find(
    (rp: any) => rp.start_pcb_port_id,
  )?.start_pcb_port_id
  const trace0EndPort = trace0.route.find(
    (rp: any) => rp.end_pcb_port_id,
  )?.end_pcb_port_id
  const trace1StartPort = trace1.route.find(
    (rp: any) => rp.start_pcb_port_id,
  )?.start_pcb_port_id
  const trace1EndPort = trace1.route.find(
    (rp: any) => rp.end_pcb_port_id,
  )?.end_pcb_port_id

  expect(trace0StartPort).toBeDefined()
  expect(trace0EndPort).toBeDefined()
  expect(trace1StartPort).toBeDefined()
  expect(trace1EndPort).toBeDefined()

  expect(
    connectivityMap.areIdsConnected(trace0.pcb_trace_id, trace0StartPort),
  ).toBe(true)
  expect(
    connectivityMap.areIdsConnected(trace0.pcb_trace_id, trace0EndPort),
  ).toBe(true)
  expect(
    connectivityMap.areIdsConnected(trace1.pcb_trace_id, trace1StartPort),
  ).toBe(true)
  expect(
    connectivityMap.areIdsConnected(trace1.pcb_trace_id, trace1EndPort),
  ).toBe(true)

  expect(
    connectivityMap.areIdsConnected(trace0.pcb_trace_id, trace1.pcb_trace_id),
  ).toBe(false)
})
