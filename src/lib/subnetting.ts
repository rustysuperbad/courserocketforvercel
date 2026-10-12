/** Client-side IPv4 subnetting helpers for the networking practice tool. */

export function ipv4ToInt(ip: string): number {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) throw new Error("Enter an IPv4 address with four octets.");
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) throw new Error("Each IPv4 octet must be 0–255.");
  return (((octets[0] ?? 0) << 24) >>> 0) + ((octets[1] ?? 0) << 16) + ((octets[2] ?? 0) << 8) + (octets[3] ?? 0);
}

export function intToIpv4(value: number): string {
  const n = value >>> 0;
  return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
}

export function prefixMask(prefix: number): number {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw new Error("Prefix length must be 0–32.");
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

export function networkAddress(ip: string, prefix: number): string {
  return intToIpv4(ipv4ToInt(ip) & prefixMask(prefix));
}

export function broadcastAddress(ip: string, prefix: number): string {
  return intToIpv4((ipv4ToInt(ip) & prefixMask(prefix)) | (~prefixMask(prefix) >>> 0));
}

export function usableHostCount(prefix: number): number {
  if (prefix >= 31) return 0;
  return 2 ** (32 - prefix) - 2;
}

export type SubnetProblem = { id: string; prompt: string; ip: string; prefix: number; network: string; broadcast: string; hosts: number };

export function generateSubnetProblem(seed = Date.now() % 10_000): SubnetProblem {
  const third = 1 + (seed % 200);
  const prefix = ([24, 25, 26, 27, 28] as const)[seed % 5] ?? 24;
  const ip = `192.168.${third}.19`;
  return {
    id: `${ip}/${prefix}`,
    prompt: `What is the network address, broadcast address, and usable host count for ${ip}/${prefix}?`,
    ip,
    prefix,
    network: networkAddress(ip, prefix),
    broadcast: broadcastAddress(ip, prefix),
    hosts: usableHostCount(prefix),
  };
}

export function gradeSubnetAnswer(problem: SubnetProblem, answer: { network: string; broadcast: string; hosts: string | number }): { correct: boolean; expected: SubnetProblem } {
  const hosts = Number(answer.hosts);
  const correct = networkAddress(answer.network, 32) === problem.network
    && networkAddress(answer.broadcast, 32) === problem.broadcast
    && hosts === problem.hosts;
  return { correct, expected: problem };
}

export const PROTOCOL_STEPS = [
  { id: "dns", label: "Resolve the name with DNS" },
  { id: "tcp", label: "Open a TCP connection" },
  { id: "tls", label: "Perform the TLS handshake" },
  { id: "http", label: "Send the HTTP request" },
] as const;

export function gradeProtocolOrder(order: string[]): boolean {
  return order.join(",") === PROTOCOL_STEPS.map((step) => step.id).join(",");
}
