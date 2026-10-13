import { useState } from "react";
import Navbar from "../../components/Navbar";
import PythonSandbox from "../../components/learn/PythonSandbox";
import { SANDBOX_STARTERS, type SandboxLangId } from "../../components/learn/sandboxLanguages";
import "../../styles/learn.css";

export default function Studio() {
  const [language, setLanguage] = useState<SandboxLangId>("python");
  const [buffers, setBuffers] = useState<Record<SandboxLangId, string>>(() => ({ ...SANDBOX_STARTERS }));

  return (
    <div className="cr-shell">
      <Navbar />
      <main className="cr-studio" id="main">
        <section className="cr-cell cr-cell-ink cr-span-12 cr-scroll-rise" aria-label="Code sandbox">
          <PythonSandbox
            language={language}
            onLanguageChange={setLanguage}
            code={buffers[language]}
            onCodeChange={(value) => setBuffers((current) => ({ ...current, [language]: value }))}
            note="Pick a language. It runs in this browser. Open a coding course to try it next to the lesson."
          />
        </section>
      </main>
    </div>
  );
}
