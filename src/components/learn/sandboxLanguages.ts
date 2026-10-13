export type SandboxLangId = "python" | "javascript" | "typescript" | "sql" | "html";

export type SandboxLanguage = {
  id: SandboxLangId;
  label: string;
  file: string;
};

export const SANDBOX_LANGUAGES: SandboxLanguage[] = [
  { id: "python", label: "Python", file: "main.py" },
  { id: "javascript", label: "JavaScript", file: "main.js" },
  { id: "typescript", label: "TypeScript", file: "main.ts" },
  { id: "sql", label: "SQL", file: "query.sql" },
  { id: "html", label: "HTML", file: "index.html" },
];

export const SANDBOX_STARTERS: Record<SandboxLangId, string> = {
  python: `def main():
    print("What should this program do first?")

if __name__ == "__main__":
    main()
`,
  javascript: `function main() {
  console.log("What should this program do first?");
}

main();
`,
  typescript: `function greet(name: string): string {
  return "Hello, " + name;
}

console.log(greet("sandbox"));
`,
  sql: `CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  text TEXT
);
INSERT INTO notes (text) VALUES ('hello from sql');
SELECT * FROM notes;
`,
  html: `<!doctype html>
<p>Hello from the sandbox.</p>
`,
};

const LANG_PATTERNS: { id: SandboxLangId; re: RegExp }[] = [
  { id: "typescript", re: /\b(typescript|\.tsx?\b|\bts\b)\b/i },
  { id: "python", re: /\b(python|pyodide|django|flask|pandas|numpy|pytorch|jupyter|\.py\b)\b/i },
  { id: "sql", re: /\b(sql|postgres|postgresql|mysql|sqlite|database quer)/i },
  { id: "javascript", re: /\b(javascript|\.jsx?\b|\bjs\b|node\.?js|react|vue|svelte|next\.?js|express)\b/i },
  { id: "html", re: /\b(html|css|markup|web page|dom)\b/i },
];

const GENERIC_CODE =
  /\b(programming|coding|code|software|developer|algorithm|data structure|compiler|runtime|scripting|machine learning|data science|neural network|deep learning|java\b|kotlin|golang|rust|c\+\+|c#|csharp|php|ruby|swift)\b/i;

function courseCorpus(course: {
  title?: string;
  topic?: string;
  description?: string;
  courseKeyConcepts?: string[];
  modules?: Array<{
    title?: string;
    summary?: string;
    concepts?: string[];
    lessons?: Array<{ heading?: string; text?: string }>;
  }>;
} | null | undefined): string {
  if (!course) return "";
  const bits: string[] = [
    course.title || "",
    course.topic || "",
    course.description || "",
    ...(course.courseKeyConcepts || []),
  ];
  for (const mod of course.modules || []) {
    bits.push(mod.title || "", mod.summary || "", ...(mod.concepts || []));
    for (const lesson of mod.lessons || []) {
      bits.push(lesson.heading || "", String(lesson.text || "").slice(0, 500));
    }
  }
  return bits.filter(Boolean).join(" ");
}

export function detectSandboxLanguage(course: Parameters<typeof courseCorpus>[0]): SandboxLangId | null {
  const text = courseCorpus(course);
  if (!text.trim()) return null;
  const fence = text.match(/```(python|py|javascript|js|typescript|ts|tsx|sql|html|css)/i);
  if (fence) {
    const tag = fence[1].toLowerCase();
    if (tag === "py" || tag === "python") return "python";
    if (tag === "ts" || tag === "tsx" || tag === "typescript") return "typescript";
    if (tag === "js" || tag === "javascript") return "javascript";
    if (tag === "sql") return "sql";
    if (tag === "html" || tag === "css") return "html";
  }
  for (const { id, re } of LANG_PATTERNS) {
    if (re.test(text)) return id;
  }
  if (GENERIC_CODE.test(text) || /```/.test(text)) return "python";
  return null;
}

export function courseNeedsSandbox(course: Parameters<typeof courseCorpus>[0]): boolean {
  return detectSandboxLanguage(course) != null;
}

export function moduleStarter(lang: SandboxLangId, title: string): string {
  const clean = String(title || "module").replace(/\n/g, " ");
  if (lang === "python") return `# ${clean}\nprint("Try a small piece of this module.")\n`;
  if (lang === "javascript") return `// ${clean}\nconsole.log("Try a small piece of this module.");\n`;
  if (lang === "typescript") return `// ${clean}\nconst note: string = "Try a small piece of this module.";\nconsole.log(note);\n`;
  if (lang === "sql") return `-- ${clean}\nSELECT 'Try a small piece of this module' AS note;\n`;
  return `<!-- ${clean} -->\n<p>Try a small piece of this module.</p>\n`;
}
