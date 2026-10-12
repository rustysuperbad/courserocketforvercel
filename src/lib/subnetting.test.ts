import { describe, expect, it } from "vitest";
import { broadcastAddress, generateSubnetProblem, gradeProtocolOrder, gradeSubnetAnswer, networkAddress, PROTOCOL_STEPS, usableHostCount } from "./subnetting";

describe("subnetting", () => {
  it("computes network, broadcast, and hosts for a /26", () => {
    expect(networkAddress("192.168.10.19", 26)).toBe("192.168.10.0");
    expect(broadcastAddress("192.168.10.19", 26)).toBe("192.168.10.63");
    expect(usableHostCount(26)).toBe(62);
  });

  it("grades a generated problem", () => {
    const problem = generateSubnetProblem(3);
    expect(gradeSubnetAnswer(problem, { network: problem.network, broadcast: problem.broadcast, hosts: problem.hosts }).correct).toBe(true);
    expect(gradeSubnetAnswer(problem, { network: "10.0.0.0", broadcast: problem.broadcast, hosts: problem.hosts }).correct).toBe(false);
  });
});

describe("protocol order", () => {
  it("accepts DNS then TCP then TLS then HTTP", () => {
    expect(gradeProtocolOrder(PROTOCOL_STEPS.map((step) => step.id))).toBe(true);
    expect(gradeProtocolOrder(["http", "dns", "tcp", "tls"])).toBe(false);
  });
});
