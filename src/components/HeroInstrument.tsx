import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { usePrefersReducedMotion } from "../lib/motionPref";
import { scriptedCourseForGoal, type DemoModule } from "../data/scriptedDemos";

export default function HeroInstrument({ goal }: { goal: string }) {
  const reduce = usePrefersReducedMotion();
  const course = useMemo(() => scriptedCourseForGoal(goal), [goal]);
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    setVisible(reduce ? course.modules.length : 0);
    if (reduce) return;
    const timers: number[] = [];
    course.modules.forEach((_, index) => {
      timers.push(window.setTimeout(() => setVisible(index + 1), 180 + index * 220));
    });
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [course, reduce]);

  return (
    <div className="cr-instrument" aria-live="polite" aria-label="Scripted course assembling from your goal">
      <div className="cr-instrument-head">
        <div>
          <div className="cr-kicker">{course.domain}</div>
          <strong>{course.goal}</strong>
        </div>
        <span className="cr-kind">{course.domain === "Example" ? "Example only" : "Preview · no API"}</span>
      </div>
      {course.modules.map((module, index) => (
        <InstrumentRow key={module.id} module={module} show={index < visible} />
      ))}
    </div>
  );
}

function InstrumentRow({ module, show }: { module: DemoModule; show: boolean }) {
  return (
    <motion.div
      className={"cr-instrument-row" + (show ? " is-on" : "")}
      initial={false}
      animate={{ opacity: show ? 1 : 0.28 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <span className="cr-kind" aria-hidden="true">{kindMark(module.kind)}</span>
      <span>
        <b style={{ display: "block", fontWeight: 400 }}>{module.title}</b>
        <small className="cr-kind">{module.kind}</small>
      </span>
      <span className="cr-kind">{show ? "ready" : "…"}</span>
    </motion.div>
  );
}

function kindMark(kind: DemoModule["kind"]): string {
  if (kind === "quiz") return "Q";
  if (kind === "video") return "V";
  if (kind === "paper") return "P";
  return "L";
}
