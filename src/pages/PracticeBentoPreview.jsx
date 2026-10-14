import { useState } from "react";
import Navbar from "../components/Navbar";
import PracticeBento from "../components/PracticeBento";

const MOCK_VIDEOS = [
  {
    videoId: "l0iFsIJIsZc",
    title: "Minimax, explained with a tiny chess tree",
    channel: "Computerphile",
    thumbnail: "https://img.youtube.com/vi/l0iFsIJIsZc/hqdefault.jpg",
  },
  {
    videoId: "VpD8GMgKDkk",
    title: "Bitboards in eight minutes",
    channel: "Chess Programming",
    thumbnail: "https://img.youtube.com/vi/VpD8GMgKDkk/mqdefault.jpg",
  },
];

const MOCK_PAPERS = [
  {
    title: "Programming a Computer for Playing Chess",
    authors: "Claude Shannon",
    year: 1950,
    url: "https://vision.unipv.it/IA1/ProgrammingaComputerforPlayingChess.pdf",
    abstract: "The original sketch of a chess-playing program: evaluation, search, and why the game is a good test of machine thought.",
  },
  {
    title: "Chess as Search",
    authors: "Turing & others",
    year: 1953,
    url: "https://example.com/chess-search",
  },
];

const MOCK_QUIZ = [
  {
    question: "What does minimax actually compare?",
    options: ["Every legal move at random", "The worst reply the opponent can force", "Only captures", "Opening-book lines"],
    correctIndex: 1,
    explanation: "It assumes both sides play the move that is best for them, so you score a line by the worst reply you cannot avoid.",
  },
  {
    question: "A board in code is best stored as:",
    options: ["A screenshot", "A list of piece names", "A position you can generate moves from", "A paragraph of English"],
    correctIndex: 2,
    explanation: "The lesson starts with data you can query, not a picture of a board.",
  },
];

export default function PracticeBentoPreview() {
  const [code, setCode] = useState(`def score(depth):
    if depth == 0:
        return 1
    return score(depth - 1) * 2

print("leaf", score(0))
print("depth 3", score(3))
`);
  const [lang, setLang] = useState("python");
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);

  const correct = MOCK_QUIZ.filter((item, index) => answers[index] === item.correctIndex).length;

  return (
    <div className="cr-shell">
      <Navbar />
      <main id="main" className="cr-page" style={{ maxWidth: 1100 }}>
        <article className="cr-course-lesson">
          <p className="cr-kicker">Course</p>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "clamp(32px, 5vw, 52px)", letterSpacing: "-0.04em", margin: "8px 0 16px" }}>
            Legal moves, then search
          </h1>
          <p className="cr-body">The lesson sits above. Watch, try, read, and check live in the bento below — scripted preview, no API.</p>
        </article>
        <PracticeBento
          showSandbox
          sandboxLang={lang}
          onSandboxLang={setLang}
          sandboxCode={code}
          onSandboxCode={setCode}
          videos={MOCK_VIDEOS}
          papers={MOCK_PAPERS}
          quiz={MOCK_QUIZ}
          quizAnswers={answers}
          quizSubmitted={submitted}
          onQuizPick={(q, o) => setAnswers((prev) => ({ ...prev, [q]: o }))}
          onQuizSubmit={() => setSubmitted(true)}
          onQuizReset={() => { setAnswers({}); setSubmitted(false); }}
          quizCorrect={correct}
          nextLabel="Next module →"
          onNext={() => { setAnswers({}); setSubmitted(false); }}
        />
      </main>
    </div>
  );
}
