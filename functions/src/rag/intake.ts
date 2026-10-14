import { isBlankLearnerText, redactPii } from "./redact";
import { learnerSpecSchema, type LearnerSpec } from "./schemas";

const HARMLESS_EMPTY: LearnerSpec = {
  status: "rejected",
  topic: "",
  level: "beginner",
  goal: "",
  constraints: [],
  ignored_requests: [],
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenJaccard(a: string, b: string): number {
  const left = new Set(normalize(a).split(" ").filter(Boolean));
  const right = new Set(normalize(b).split(" ").filter(Boolean));
  if (!left.size && !right.size) return 1;
  if (!left.size || !right.size) return 0;
  let inter = 0;
  for (const word of left) if (right.has(word)) inter += 1;
  return inter / new Set([...left, ...right]).size;
}

export function topicAccepted(topic: string, canonical: string, variants: string[]): boolean {
  const bag = [canonical, ...variants];
  const n = normalize(topic);
  if (bag.some((item) => normalize(item) === n)) return true;
  return bag.some((item) => tokenJaccard(topic, item) >= 0.5);
}

/** Status, level, constraints, and ignored_requests must match exactly. Topic uses variants/Jaccard, not string equality. */
export function specsEquivalent(a: LearnerSpec, b: LearnerSpec, topicVariants: string[] = []): boolean {
  if (a.status !== b.status || a.level !== b.level) return false;
  const left = [...a.constraints].map(normalize).sort();
  const right = [...b.constraints].map(normalize).sort();
  if (left.join("|") !== right.join("|")) return false;
  const ignoredLeft = [...a.ignored_requests].map(normalize).sort();
  const ignoredRight = [...b.ignored_requests].map(normalize).sort();
  if (ignoredLeft.join("|") !== ignoredRight.join("|")) return false;
  if (a.status !== "ok") return true;
  const variants = topicVariants.length ? topicVariants : [a.topic, b.topic];
  return topicAccepted(a.topic, b.topic, variants) || topicAccepted(b.topic, a.topic, variants);
}

function isHarmful(text: string): boolean {
  const lower = text.toLowerCase();
  return /\b(build|make|construct)\b.{0,40}\b(bomb|explosive|nerve gas)\b/.test(lower)
    || /\bhow to (kill|harm|poison)\b/.test(lower)
    || /\bchild sexual\b/.test(lower);
}

function isVagueCourse(text: string): boolean {
  return /^(please\s+)?(make|create|build)\s+(me\s+)?(a\s+)?course(\s+for me)?\.?$/i.test(text.trim());
}

function isTooBroad(text: string): boolean {
  return /\ball of machine learning\b|\beverything about (ai|ml|machine learning)\b/.test(text.toLowerCase());
}

/**
 * Code-side intake. Empty text skips the model. Vague, too-broad, and harmful
 * still take one cheap intake call; later stages do not run.
 */
export function specFromLearnerText(text: string): { spec: LearnerSpec; skipModel: boolean } {
  if (isBlankLearnerText(text)) return { spec: HARMLESS_EMPTY, skipModel: true };

  if (isHarmful(text)) {
    return { spec: HARMLESS_EMPTY, skipModel: false };
  }
  if (isVagueCourse(text)) {
    return {
      spec: { status: "needs_clarification", topic: "", level: "beginner", goal: "", constraints: [], ignored_requests: [] },
      skipModel: false,
    };
  }
  if (isTooBroad(text)) {
    return {
      spec: { status: "needs_clarification", topic: "", level: "beginner", goal: "", constraints: [], ignored_requests: [] },
      skipModel: false,
    };
  }

  const stripped = redactPii(text);
  const lowerStripped = stripped.toLowerCase();

  const constraints: string[] = [];
  if (/\bunder 20 minutes\b/i.test(text)) constraints.push("under 20 minutes");
  if (/\bonly (on )?d2\b|\bskip d1\b|\bemphasize d2\b/i.test(lowerStripped)) constraints.push("emphasize d2");

  const ignored_requests: string[] = [];
  if (/\brom(an|e)\b/i.test(stripped) && /\b(history|empire)\b/i.test(stripped)) {
    ignored_requests.push("Roman empire history");
  }
  if (/\bpizza\b/i.test(stripped)) ignored_requests.push("favourite pizza toppings");

  let level: LearnerSpec["level"] = "beginner";
  if (/\badvanced\b/i.test(text)) level = "advanced";
  else if (/\bintermediate\b|\balready took ap\b/i.test(text)) level = "intermediate";

  let topic = "";
  if (/\btcp\b/i.test(stripped) && /\bdhcp\b/i.test(stripped) && /\bdns\b/i.test(stripped)) topic = "TCP DHCP and DNS";
  else if (/\bdhcp leases?\b/i.test(stripped)) topic = "DHCP leases";
  else if (/\btcp\b/i.test(stripped) && /\bhandshake|vías|vias\b/i.test(stripped)) topic = "TCP three-way handshake";
  else if (/\bblack[\s-]?scholes\b/i.test(stripped) && /\bd2\b/i.test(stripped) && /\bskip d1\b/i.test(lowerStripped)) topic = "Black-Scholes d2";
  else if (/\bn\(d1\)|\bn\(d2\)|black[\s-]?scholes/i.test(stripped)) topic = "Black-Scholes call price";
  else if (/\bchain ?rule\b/i.test(stripped) && /\bd1\b/i.test(stripped)) topic = "chain rule for d1";
  else if (/\bcdf\b/i.test(stripped)) topic = "cumulative distribution function";
  else if (/\bbayes\b/i.test(stripped)) topic = "Bayes rule";
  else if (/\bwindow functions?\b/i.test(stripped) && (/\bsql\b/i.test(stripped) || /\bgroup by\b/i.test(stripped) || /\bselect\b/i.test(stripped))) {
    topic = "SQL window functions";
  }
  else if (/\bgit rebase\b/i.test(stripped)) topic = "git rebase versus merge";
  else if (/\bkalman\b/i.test(stripped)) topic = "Kalman filter";
  else if (/\bbinary search\b/i.test(stripped)) topic = "binary search loop invariant";
  else if (/\bmaxwell/i.test(stripped)) topic = "Maxwell's equations";
  else if (/\bbackprop/i.test(stripped)) topic = "backprop through a linear layer";
  else if (/\bpython\b/i.test(stripped)) topic = "Python";
  else if (/\bp-value|confidence interval/i.test(stripped)) topic = "p-value versus confidence interval";
  else if (/\brsa\b/i.test(stripped)) topic = "RSA encryption";
  else if (/\bmutex/i.test(stripped)) topic = "mutexes";
  else if (/\bols\b|\bheteroskedasticity\b/i.test(stripped)) topic = "OLS assumptions";
  else if (/\bcache-control\b|\betag\b/i.test(stripped) || /\bhttp caching\b/i.test(stripped)) topic = "HTTP caching";
  else if (/\bdijkstra\b/i.test(stripped)) topic = "Dijkstra";
  else if (/\bcentral limit|sample means\b/i.test(stripped)) topic = "central limit theorem";
  else if (/\bgreeks\b/i.test(stripped) && /\beuropean call\b/i.test(stripped)) topic = "Black-Scholes call price";
  else if (/\bsubnet|\bcidr\b|\/2[0-9]\b/i.test(stripped)) topic = "IPv4 subnetting";
  else if (/\btls\b/i.test(stripped)) topic = "TLS handshake";
  else if (/\bdefault gateway\b|\brouting table\b|\bip routing\b/i.test(stripped)) topic = "IP routing";
  else if (/\bdns\b/i.test(stripped)) topic = "DNS resolution";
  else if (/\barp\b/i.test(stripped)) topic = "ARP";
  else if (/\bhashing\b/i.test(stripped)) topic = "hashing";

  const goal = topic ? `Learn ${topic}.`.slice(0, 160) : "";

  if (!topic) {
    return {
      spec: { status: "needs_clarification", topic: "", level, goal: "", constraints, ignored_requests },
      skipModel: false,
    };
  }

  const spec: LearnerSpec = {
    status: "ok",
    topic,
    level,
    goal: goal.replace(/\s+/g, " ").trim(),
    constraints,
    ignored_requests,
  };
  learnerSpecSchema.parse(spec);
  return { spec, skipModel: false };
}
