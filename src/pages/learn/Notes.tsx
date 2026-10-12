import { useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../components/Navbar";
import { describeCallableError, uploadLearnerNotes, type ConceptMap, type Flashcard } from "../../lib/learningApi";
import "../../styles/learn.css";

export default function Notes() {
  const [title, setTitle] = useState("My networking notes");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [map, setMap] = useState<ConceptMap | null>(null);
  const [openCard, setOpenCard] = useState<number | null>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      setError("Binary PDFs are not parsed yet. Paste the extracted text, or upload a .txt / .md file.");
      return;
    }
    try {
      const contents = await file.text();
      setTitle(file.name.replace(/\.[^.]+$/, ""));
      setText(contents.slice(0, 50_000));
      setError("");
    } catch {
      setError("That file could not be read as text.");
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await uploadLearnerNotes(title, text);
      setCards(result.flashcards);
      setMap(result.conceptMap);
      setNotice(`${result.chunkCount} private chunks stored. ${result.retrievalNote} Estimated embedding cost $${result.estimatedCostUsd.toFixed(5)}.`);
    } catch (err) {
      setError(describeCallableError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />
      <main className="lr-page" id="main">
        <header className="lr-head">
          <div className="cr-page-kicker">PRIVATE SOURCES</div>
          <h1>Attach your notes</h1>
          <p>
            Uploaded notes are chunked, embedded, and retrieved only for your account.
            They are never labelled as verified public sources. Flashcards are extracted from your text, not generated as verified lessons.
          </p>
        </header>
        <form className="cr-card lr-card" onSubmit={handleSubmit} noValidate>
          <label className="lr-field">
            <span>Title</span>
            <input className="cr-input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} required />
          </label>
          <label className="lr-field">
            <span>Notes or pasted PDF text</span>
            <textarea className="cr-input" rows={10} minLength={40} maxLength={50_000} value={text} onChange={(event) => setText(event.target.value)} required />
          </label>
          <label className="lr-field">
            <span>Or attach a .txt / .md file</span>
            <input type="file" accept=".txt,.md,text/plain,text/markdown,.pdf,application/pdf" onChange={(event) => void handleFile(event)} />
          </label>
          <div className="lr-actions">
            <button type="submit" className="cr-btn cr-btn-primary" disabled={busy || text.trim().length < 40}>
              {busy ? "Embedding…" : "Store as private source"}
            </button>
          </div>
          {error && <div className="lr-error" role="alert">{error}</div>}
          {notice && <div className="lr-success" role="status">{notice}</div>}
        </form>
        {cards.length > 0 && (
          <section className="cr-card lr-card" style={{ marginTop: 16 }} aria-labelledby="cards-heading">
            <h2 id="cards-heading">Flashcards from your notes</h2>
            <ul className="lr-list" style={{ listStyle: "none", padding: 0 }}>
              {cards.map((card, index) => (
                <li key={card.prompt}>
                  <button type="button" className="lr-option" aria-expanded={openCard === index} onClick={() => setOpenCard(openCard === index ? null : index)}>
                    {card.prompt}
                  </button>
                  {openCard === index && <p className="lr-notice">{card.answer}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {map && <ConceptMapView map={map} />}
        <p className="lr-muted" style={{ marginTop: 18 }}><Link className="cr-link" to="/learn">Back to Learn</Link></p>
      </main>
    </div>
  );
}

export function ConceptMapView({ map }: { map: ConceptMap }) {
  const related = map.nodes.filter((node) => node.related);
  return (
    <section className="cr-card lr-card" style={{ marginTop: 16 }} aria-labelledby="map-heading">
      <h2 id="map-heading">Concept map</h2>
      <p className="lr-muted">Highlighted nodes matched terms in your notes. Edges are catalog prerequisites, not claims from the upload.</p>
      <ul className="lr-map">
        {map.edges.map((edge) => {
          const from = map.nodes.find((node) => node.id === edge.from);
          const to = map.nodes.find((node) => node.id === edge.to);
          if (!from || !to) return null;
          return (
            <li key={`${edge.from}->${edge.to}`}>
              <span data-related={from.related}>{from.title}</span>
              <span aria-hidden="true"> → </span>
              <span data-related={to.related}>{to.title}</span>
            </li>
          );
        })}
      </ul>
      {related.length === 0 && <p className="lr-muted">No catalog concept titles were detected in this upload.</p>}
    </section>
  );
}
