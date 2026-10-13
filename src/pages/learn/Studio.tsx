import { useState } from "react";
import Navbar from "../../components/Navbar";
import PythonSandbox from "../../components/learn/PythonSandbox";
import "../../styles/learn.css";

const STARTER = `def main():
    print("What should this program do first?")

if __name__ == "__main__":
    main()
`;

export default function Studio() {
  const [code, setCode] = useState(STARTER);

  return (
    <div className="cr-shell">
      <Navbar />
      <main className="cr-studio" id="main">
        <section className="cr-cell cr-cell-ink cr-span-12 cr-scroll-rise" aria-label="Python sandbox">
          <PythonSandbox
            heading="main.py"
            code={code}
            onCodeChange={setCode}
            note="Runs in this browser. Open a course to try code next to the lesson."
          />
        </section>
      </main>
    </div>
  );
}
