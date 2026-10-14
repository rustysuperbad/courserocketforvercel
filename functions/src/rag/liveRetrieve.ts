import { fakeProvidersEnabled } from "./config";
import type { RetrievedSourceChunk } from "./retrieve";
import { retrieveForGeneration } from "../server";

export const FAKE_SOURCE_CHUNKS: RetrievedSourceChunk[] = [
  { chunk_id: "C1", source_id: "S1", text: "N(x) denotes the standard normal CDF. N(0) equals 0.5.", score: 0.91, title: "Normal tables", url: "https://example.test/cdf" },
  { chunk_id: "C2", source_id: "S1", text: "The standard normal density φ(x) is not the cumulative probability N(x).", score: 0.84, title: "Normal tables", url: "https://example.test/cdf" },
  { chunk_id: "C3", source_id: "S2", text: "In the Black–Scholes call, N(d1) weights the spot under the risk-neutral measure.", score: 0.73, title: "Call price", url: "https://example.test/call" },
  { chunk_id: "C4", source_id: "S2", text: "Replacing N(d1) with φ(d1) produces a number that is not a probability.", score: 0.71, title: "Call price", url: "https://example.test/call" },
];

export const NETWORKING_SOURCE_CHUNKS: RetrievedSourceChunk[] = [
  { chunk_id: "N1", source_id: "NET1", text: "TCP three-way handshake: the client sends SYN, the server replies SYN-ACK, then the client sends ACK.", score: 0.9, title: "TCP handshake", url: "https://example.test/tcp" },
  { chunk_id: "N2", source_id: "NET2", text: "A DHCP lease is a timed grant of an IPv4 address, mask, gateway, and resolver from a server to a client.", score: 0.88, title: "DHCP leases", url: "https://example.test/dhcp" },
  { chunk_id: "N3", source_id: "NET3", text: "DNS maps a hostname to an IP address using recursive or iterative queries to name servers.", score: 0.86, title: "DNS", url: "https://example.test/dns" },
  { chunk_id: "N4", source_id: "NET4", text: "HTTP caching uses Cache-Control to set freshness and ETag to revalidate a stored response.", score: 0.84, title: "HTTP caching", url: "https://example.test/http" },
  { chunk_id: "N5", source_id: "NET5", text: "A /24 IPv4 prefix leaves 8 host bits; CIDR subnetting counts usable addresses from those bits.", score: 0.83, title: "Subnetting", url: "https://example.test/cidr" },
  { chunk_id: "N6", source_id: "NET6", text: "TLS handshake authenticates the server with a certificate and then derives session keys.", score: 0.82, title: "TLS", url: "https://example.test/tls" },
  { chunk_id: "N7", source_id: "NET7", text: "The default gateway is the next hop in the routing table for destinations off the local subnet.", score: 0.81, title: "Routing", url: "https://example.test/gw" },
  { chunk_id: "N8", source_id: "NET8", text: "ARP maps an IPv4 address to a MAC address so a frame can be delivered on the local Ethernet LAN.", score: 0.8, title: "ARP", url: "https://example.test/arp" },
];

export async function liveOrFakeRetrieve(query: string, concepts: string[], ownerUid: string): Promise<RetrievedSourceChunk[]> {
  if (fakeProvidersEnabled()) return FAKE_SOURCE_CHUNKS;
  const result = await retrieveForGeneration(query, { conceptSlug: concepts[0], ownerUid });
  return result.chunks.map((chunk, index) => ({
    chunk_id: chunk.id,
    source_id: chunk.url || chunk.id,
    text: chunk.text,
    title: chunk.title,
    url: chunk.url,
    score: 0.8 - index * 0.02,
  }));
}
