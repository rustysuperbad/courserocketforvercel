import { fakeProvidersEnabled } from "./config";
import type { RetrievedSourceChunk } from "./retrieve";
import { retrieveForGeneration } from "../server";

export const FAKE_SOURCE_CHUNKS: RetrievedSourceChunk[] = [
  { chunk_id: "C1", source_id: "S1", text: "N(x) denotes the standard normal CDF. N(0) equals 0.5.", score: 0.91, title: "Normal tables", url: "https://example.test/cdf" },
  { chunk_id: "C2", source_id: "S1", text: "The standard normal density φ(x) is not the cumulative probability N(x).", score: 0.84, title: "Normal tables", url: "https://example.test/cdf" },
  { chunk_id: "C3", source_id: "S2", text: "In the Black–Scholes call, N(d1) weights the spot under the risk-neutral measure.", score: 0.73, title: "Call price", url: "https://example.test/call" },
  { chunk_id: "C4", source_id: "S2", text: "Replacing N(d1) with φ(d1) produces a number that is not a probability.", score: 0.71, title: "Call price", url: "https://example.test/call" },
];

/** Launch-domain corpus. No embeddings. Lexical retrieve only. */
export const NETWORKING_SOURCE_CHUNKS: RetrievedSourceChunk[] = [
  {
    chunk_id: "N1", source_id: "NET-TCP-A", score: 0.9, title: "TCP handshake flags", url: "https://example.test/tcp-flags",
    text: "A TCP listener waits for a segment whose SYN control bit is set and whose ACK bit is clear. That segment also carries an initial sequence number chosen by the opener. The listener does not yet consider the connection established. It answers with a single segment that sets both SYN and ACK, and it writes its own initial sequence number in the header. Only after the opener returns an ACK covering that number do both ends mark the connection as established. This three-step exchange is the TCP three-way handshake.",
  },
  {
    chunk_id: "N2", source_id: "NET-TCP-B", score: 0.88, title: "TCP sequence numbers", url: "https://example.test/tcp-seq",
    text: "Each TCP handshake step advertises a sequence number so later data can be ordered. The opener's first SYN names its starting sequence. The listener's SYN-ACK names a different starting sequence for the reverse direction, and the acknowledgment field equals the opener's sequence plus one. The opener's final ACK copies that same plus-one value. If either side sees an acknowledgment that does not match the sequence it just offered, it treats the handshake as invalid and does not open the socket.",
  },
  {
    chunk_id: "N3", source_id: "NET-TCP-C", score: 0.86, title: "TCP connection states", url: "https://example.test/tcp-states",
    text: "On the opener, the path is CLOSED to SYN-SENT after the first synchronize segment, then ESTABLISHED after the matching ACK. On the listener, LISTEN moves to SYN-RECEIVED when the first synchronize segment arrives, then ESTABLISHED after the opener's ACK. Applications that call connect() sit in SYN-SENT until the handshake finishes. A reset segment at any of these states aborts the attempt. The handshake is therefore both a flag dance and a pair of state machines advancing together.",
  },
  {
    chunk_id: "N4", source_id: "NET-TCP-D", score: 0.84, title: "Why TCP handshakes exist", url: "https://example.test/tcp-why",
    text: "TCP is reliable and bidirectional, so both parties must agree on starting sequence numbers before user data is trusted. The extra round trip also proves that the peer received the opener's address and port, which limits some spoofed SYNs. Older designs used a two-way exchange; that left one side unsure that its own synchronize bit had been seen. The three-way form closes that gap. Lost handshake segments are retransmitted from the SYN-SENT or SYN-RECEIVED state until a timer gives up.",
  },
  { chunk_id: "N5", source_id: "NET-DHCP-A", score: 0.88, title: "DHCP leases", url: "https://example.test/dhcp", text: "A DHCP lease is a timed grant of an IPv4 address, mask, default gateway, and resolver. The grant ends at a deadline the server chose. If the client does not renew in time, the address returns to the pool and another host may receive it." },
  { chunk_id: "N5b", source_id: "NET-DHCP-B", score: 0.86, title: "DHCP discover", url: "https://example.test/dhcp-dora", text: "A client without an address broadcasts DHCPDISCOVER. Servers may answer with DHCPOFFER. The client picks one offer and sends DHCPREQUEST. The chosen server confirms with DHCPACK, which is when the lease actually starts." },
  { chunk_id: "N5c", source_id: "NET-DHCP-C", score: 0.84, title: "DHCP renew", url: "https://example.test/dhcp-renew", text: "Renewal usually starts at half the lease lifetime, unicast to the same server. If that server is gone, the client later broadcasts. A NAK means it must start discovery again rather than keep using the old address." },
  { chunk_id: "N5d", source_id: "NET-DHCP-D", score: 0.82, title: "DHCP options", url: "https://example.test/dhcp-opt", text: "Besides the IPv4 address, a lease commonly carries subnet mask, router, and DNS server options. Without the router option the host can talk on-LAN but not off-subnet. Without DNS it cannot resolve names." },
  { chunk_id: "N6", source_id: "NET-DNS-A", score: 0.86, title: "DNS", url: "https://example.test/dns", text: "DNS maps a hostname to an IP address. A stub resolver asks a recursive resolver, which either answers from cache or walks the hierarchy until an authoritative name server returns the record." },
  { chunk_id: "N6b", source_id: "NET-DNS-B", score: 0.84, title: "DNS TTL", url: "https://example.test/dns-ttl", text: "Each DNS record carries a TTL. Recursive resolvers cache the answer for that lifetime. A low TTL makes changes visible sooner; a high TTL cuts query load. Expired cache entries are refetched, not reused." },
  { chunk_id: "N6c", source_id: "NET-DNS-C", score: 0.82, title: "DNS types", url: "https://example.test/dns-types", text: "An A record is IPv4, AAAA is IPv6, and CNAME aliases one name to another. MX points mail at a host. The query type must match what the client needs; asking for A will not return an MX." },
  { chunk_id: "N6d", source_id: "NET-DNS-D", score: 0.8, title: "DNS iterative", url: "https://example.test/dns-iter", text: "Iterative resolution starts at a root hint, then a TLD server, then the zone's authoritative server. Each referral narrows the suffix. Recursion is a service the resolver performs; the client usually does not walk that path itself." },
  { chunk_id: "N7", source_id: "NET-HTTP-A", score: 0.84, title: "HTTP caching", url: "https://example.test/http", text: "HTTP caching uses Cache-Control to decide whether a stored response is still fresh. When it is stale, a validator such as ETag lets the origin say 304 and skip sending the body again." },
  { chunk_id: "N7b", source_id: "NET-HTTP-B", score: 0.82, title: "HTTP freshness", url: "https://example.test/http-fresh", text: "max-age is a lifetime in seconds from when the response was generated. no-store forbids saving the response. no-cache means it may be stored but must be revalidated before reuse. These directives are independent of cookies." },
  { chunk_id: "N7c", source_id: "NET-HTTP-C", score: 0.8, title: "HTTP ETag", url: "https://example.test/http-etag", text: "An ETag is an opaque validator. On a later request the client sends If-None-Match. If the origin's current tag matches, it returns 304. If the representation changed, it returns 200 with a new body and a new tag." },
  { chunk_id: "N7d", source_id: "NET-HTTP-D", score: 0.78, title: "HTTP Vary", url: "https://example.test/http-vary", text: "Vary lists request headers that change which stored response is the right one, commonly Accept-Encoding. Two clients can share a cache key only when those headers match. Ignoring Vary can serve the wrong encoding." },
  { chunk_id: "N8", source_id: "NET-CIDR-A", score: 0.83, title: "Subnetting", url: "https://example.test/cidr", text: "A /24 IPv4 prefix leaves eight host bits. Usable addresses are those host values except all-zeros (network) and all-ones (broadcast) on a typical Ethernet subnet. CIDR is just prefix length, not a separate protocol." },
  { chunk_id: "N8b", source_id: "NET-CIDR-B", score: 0.81, title: "CIDR math", url: "https://example.test/cidr-math", text: "Host count for prefix length n is 2 to the power of (32-n), including network and broadcast. A /26 has 64 addresses and 62 usable on a standard subnet. Longer prefixes mean smaller subnets." },
  { chunk_id: "N8c", source_id: "NET-CIDR-C", score: 0.79, title: "Subnet mask", url: "https://example.test/mask", text: "The subnet mask is the prefix written as four octets, so /24 is 255.255.255.0. Bitwise AND of an address and the mask yields the network number. Two hosts are on-link when those network numbers match." },
  { chunk_id: "N8d", source_id: "NET-CIDR-D", score: 0.77, title: "VLSM", url: "https://example.test/vlsm", text: "Variable-length subnet masks let one allocated block be split into unequal prefixes. A /24 can become a /26 for servers and several /28s for small LANs. Each sub-prefix must not overlap." },
  { chunk_id: "N9", source_id: "NET-TLS-A", score: 0.82, title: "TLS", url: "https://example.test/tls", text: "A TLS handshake authenticates the server with a certificate chain and then derives symmetric session keys. Application records after that point are encrypted with those keys, not with the certificate's public key for every byte." },
  { chunk_id: "N9b", source_id: "NET-TLS-B", score: 0.8, title: "TLS certs", url: "https://example.test/tls-cert", text: "The client checks that the certificate is signed by a trusted issuer, is not expired, and names the host being contacted. A name mismatch is a handshake failure even if the key is strong. The private key never leaves the server." },
  { chunk_id: "N9c", source_id: "NET-TLS-C", score: 0.78, title: "TLS records", url: "https://example.test/tls-rec", text: "After the handshake, each TLS record has a type, version, length, and ciphertext. HTTP bytes ride inside application-data records. Reusing a session ticket can skip a full handshake but still installs fresh record keys." },
  { chunk_id: "N9d", source_id: "NET-TLS-D", score: 0.76, title: "TLS vs TCP", url: "https://example.test/tls-tcp", text: "TLS runs on an already-established TCP connection (or equivalent reliable stream). It does not replace the TCP three-way handshake. Packet loss is still handled by TCP; TLS just protects confidentiality and integrity of the bytes." },
  { chunk_id: "N10", source_id: "NET-GW-A", score: 0.81, title: "Routing", url: "https://example.test/gw", text: "The default gateway is the next hop used when the destination is not on a connected prefix. The host still ARPs for that gateway's MAC, not for the remote host's MAC. Local destinations skip the gateway." },
  { chunk_id: "N10b", source_id: "NET-GW-B", score: 0.79, title: "Routing table", url: "https://example.test/rt", text: "A routing table is longest-prefix match. A /24 connected route beats the default /0. If two routes have the same prefix length, the implementation picks a metric or the first inserted entry. Missing default means off-net packets are dropped." },
  { chunk_id: "N10c", source_id: "NET-GW-C", score: 0.77, title: "On-link", url: "https://example.test/onlink", text: "On-link means the destination IPv4 address AND the local mask equals the local network number. Those frames go directly. Off-link packets are encapsulated toward the gateway even when the TTL is still large." },
  { chunk_id: "N10d", source_id: "NET-GW-D", score: 0.75, title: "TTL hop", url: "https://example.test/ttl", text: "Each router decrements IP TTL and forwards toward the next hop. When TTL hits zero the packet is discarded and an ICMP time exceeded may be sent. Traceroute uses that behaviour. The default gateway is hop one from the host." },
  { chunk_id: "N11", source_id: "NET-ARP-A", score: 0.8, title: "ARP", url: "https://example.test/arp", text: "ARP maps an IPv4 address to a MAC address so an Ethernet frame can be delivered on the local LAN. The requester broadcasts who-has; the owner unicasts a reply. The mapping is cached until a timeout." },
  { chunk_id: "N11b", source_id: "NET-ARP-B", score: 0.78, title: "ARP cache", url: "https://example.test/arp-cache", text: "An ARP cache entry is incomplete while waiting for a reply and reachable after a reply arrives. Stale entries are re-probed. Gratuitous ARP announces a mapping without a prior request, used after address assignment." },
  { chunk_id: "N11c", source_id: "NET-ARP-C", score: 0.76, title: "ARP scope", url: "https://example.test/arp-scope", text: "ARP never resolves an off-link IPv4 address. The host ARPs for the gateway instead. Trying to ARP a remote address would not reach the owner because broadcasts do not cross routers." },
  { chunk_id: "N11d", source_id: "NET-ARP-D", score: 0.74, title: "ARP vs DNS", url: "https://example.test/arp-dns", text: "DNS answers 'which IP has this name'. ARP answers 'which MAC has this local IP'. They are not substitutes. A correct DNS answer can still fail if ARP cannot find a MAC for the next hop." },
];

const TCP_CHUNK_IDS = new Set(["N1", "N2", "N3", "N4"]);

export function launchRetrieve(query: string, concepts: string[] = []): RetrievedSourceChunk[] {
  const blob = `${query} ${concepts.join(" ")}`;
  const hits = lexicalRetrieve(blob, NETWORKING_SOURCE_CHUNKS);
  if (hits.length >= 4) return hits;
  if (/\btcp\b|handshake|syn-ack|\bsyn\b/.test(blob.toLowerCase())) {
    return NETWORKING_SOURCE_CHUNKS.filter((chunk) => TCP_CHUNK_IDS.has(chunk.chunk_id));
  }
  return hits;
}

export function lexicalRetrieve(query: string, pool: RetrievedSourceChunk[]): RetrievedSourceChunk[] {
  const tokens = String(query || "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  if (!tokens.length) return [];
  return pool
    .map((chunk) => {
      const hay = `${chunk.title || ""} ${chunk.text}`.toLowerCase();
      const hits = tokens.filter((token) => hay.includes(token)).length;
      return { ...chunk, score: hits / tokens.length };
    })
    .filter((chunk) => chunk.score >= 0.12)
    .sort((a, b) => b.score - a.score);
}

export async function liveOrFakeRetrieve(query: string, concepts: string[], ownerUid: string): Promise<RetrievedSourceChunk[]> {
  if (fakeProvidersEnabled()) return FAKE_SOURCE_CHUNKS;
  const local = launchRetrieve(query, concepts);
  if (local.length) return local;
  try {
    const result = await retrieveForGeneration(query, { conceptSlug: concepts[0], ownerUid });
    return result.chunks.map((chunk, index) => ({
      chunk_id: chunk.id,
      source_id: chunk.url || chunk.id,
      text: chunk.text,
      title: chunk.title,
      url: chunk.url,
      score: 0.8 - index * 0.02,
    }));
  } catch {
    return [];
  }
}
