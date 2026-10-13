/** Cached, local-only demonstrations. Never call providers from these helpers. */

export type DemoModule = { id: string; title: string; kind: "lesson" | "quiz" | "video" | "paper"; status: "idle" | "writing" | "ready" };
export type DemoCourse = { goal: string; domain: string; modules: DemoModule[] };

const NETWORKING: DemoCourse = {
  goal: "Trace a web request across a network",
  domain: "Example",
  modules: [
    { id: "m1", title: "Addresses, not magic", kind: "lesson", status: "idle" },
    { id: "m2", title: "DNS before the first packet", kind: "lesson", status: "idle" },
    { id: "m3", title: "TCP handshake check", kind: "quiz", status: "idle" },
    { id: "m4", title: "Computer Networks — Kurose excerpt", kind: "paper", status: "idle" },
    { id: "m5", title: "Wireshark: one HTTPS fetch", kind: "video", status: "idle" },
  ],
};

const PYTHON: DemoCourse = {
  goal: "Build a chess engine in Python",
  domain: "Python",
  modules: [
    { id: "m1", title: "Board as data", kind: "lesson", status: "idle" },
    { id: "m2", title: "Legal moves, then search", kind: "lesson", status: "idle" },
    { id: "m3", title: "Minimax on a tiny tree", kind: "quiz", status: "idle" },
    { id: "m4", title: "Shannon, 1950 — Programming a Computer for Playing Chess", kind: "paper", status: "idle" },
    { id: "m5", title: "Bitboards, explained slowly", kind: "video", status: "idle" },
  ],
};

const DEFAULT_COURSE: DemoCourse = {
  goal: "Learn from what you already know",
  domain: "General",
  modules: [
    { id: "m1", title: "Name the goal in one sentence", kind: "lesson", status: "idle" },
    { id: "m2", title: "Skip what you can already do", kind: "lesson", status: "idle" },
    { id: "m3", title: "Two-minute check", kind: "quiz", status: "idle" },
    { id: "m4", title: "One source you can cite", kind: "paper", status: "idle" },
    { id: "m5", title: "One walk-through to watch", kind: "video", status: "idle" },
  ],
};

export function scriptedCourseForGoal(goal: string): DemoCourse {
  const text = goal.trim().toLowerCase();
  if (!text) return { ...DEFAULT_COURSE, modules: DEFAULT_COURSE.modules.map((item) => ({ ...item })) };
  if (/(network|subnet|dns|tcp|packet|http|router)/.test(text)) {
    return { ...NETWORKING, goal: goal.trim() || NETWORKING.goal, modules: NETWORKING.modules.map((item) => ({ ...item })) };
  }
  if (/(python|chess|code|engine|program)/.test(text)) {
    return { ...PYTHON, goal: goal.trim() || PYTHON.goal, modules: PYTHON.modules.map((item) => ({ ...item })) };
  }
  return { ...DEFAULT_COURSE, goal: goal.trim(), modules: DEFAULT_COURSE.modules.map((item) => ({ ...item })) };
}

export const THEATRE_STEPS = [
  { id: "queued", label: "Reading your goal", detail: "Just the sentence you typed." },
  { id: "path", label: "Noting what you know", detail: "We’ll skip the bits you already have." },
  { id: "retrieve", label: "Gathering material", detail: "Lessons, a quiz, something to watch." },
  { id: "write", label: "Writing the lessons", detail: "Turning the goal into modules." },
  { id: "verify", label: "Checking the quiz", detail: "Making sure the questions match the lessons." },
  { id: "resources", label: "Picking a video", detail: "One watch-through, not a dump of search results." },
  { id: "ready", label: "Ready to open", detail: "Your course is ready." },
] as const;

export function theatreIndexFromStage(stage?: string): number {
  const value = (stage || "").toLowerCase();
  if (!value || value === "queued") return 0;
  if (value.includes("path") || value.includes("diagnostic") || value.includes("mastery")) return 1;
  if (value.includes("retriev") || value.includes("source") || value.includes("embed")) return 2;
  if (value.includes("write") || value.includes("module") || value.includes("lesson")) return 3;
  if (value.includes("verif") || value.includes("critic") || value.includes("quiz")) return 4;
  if (value.includes("resource") || value.includes("video") || value.includes("paper") || value.includes("link")) return 5;
  if (value.includes("ready") || value.includes("complete") || value.includes("finish") || value === "completed") return 6;
  if (value.includes("fail") || value.includes("block")) return 3;
  return Math.min(3, THEATRE_STEPS.length - 1);
}

export type StudioTurn = { role: "assistant" | "user"; text: string; code?: string };

const STUDIO_REPLIES: Array<{ test: RegExp; turns: StudioTurn[] }> = [
  {
    test: /subnet|cidr|mask/,
    turns: [
      { role: "assistant", text: "Start with one function. We will print the network address for 192.168.10.42/24 — nothing else yet." },
      {
        role: "assistant",
        text: "This stays in the browser. Prefix 24 means the first 24 bits are the network.",
        code: "def network_address(ip: str, prefix: int) -> str:\n    parts = [int(p) for p in ip.split(\".\")]\n    mask = (0xFFFFFFFF << (32 - prefix)) & 0xFFFFFFFF\n    packed = (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]\n    net = packed & mask\n    return \".\".join(str((net >> s) & 255) for s in (24, 16, 8, 0))\n\nprint(network_address(\"192.168.10.42\", 24))",
      },
    ],
  },
  {
    test: /dns|http|packet/,
    turns: [
      { role: "assistant", text: "Write the hop list as data first. A browser fetch is an ordered story, not a diagram." },
      {
        role: "assistant",
        text: "Run this, then tell me which hop you want to zoom into.",
        code: "hops = [\"DNS\", \"TCP\", \"TLS\", \"HTTP\"]\nfor i, hop in enumerate(hops, 1):\n    print(f\"{i}. {hop}\")",
      },
    ],
  },
];

const FALLBACK_STUDIO: StudioTurn[] = [
  { role: "assistant", text: "Keep it to one file. Say the first behaviour you want to see in the console." },
  {
    role: "assistant",
    text: "Here is a stub you can extend. This is a local sketch, not a verified lesson.",
    code: "def main():\n    print(\"What should this program do first?\")\n\nif __name__ == \"__main__\":\n    main()",
  },
];

const LARGE_PROJECT = /(saas|startup|mobile app|full[- ]stack|marketplace|social network|clone of)/i;

export function studioIsLarge(brief: string): boolean {
  const text = brief.trim();
  return text.length > 280 || LARGE_PROJECT.test(text);
}

export function scriptedStudioReply(brief: string): StudioTurn[] {
  const text = brief.trim().toLowerCase();
  const hit = STUDIO_REPLIES.find((entry) => entry.test.test(text));
  return hit ? hit.turns : FALLBACK_STUDIO;
}
