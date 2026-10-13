import { motion } from "motion/react";
import GenerationTheatre from "./GenerationTheatre";
import { usePrefersReducedMotion } from "../lib/motionPref";

type Props = {
  goal: string;
  stage?: string;
  note?: string;
  percent?: number;
  status?: string;
};

export default function GenerateStartOverlay({ goal, stage, note, percent = 4, status = "running" }: Props) {
  const reduce = usePrefersReducedMotion();
  const shown = String(goal || "").trim() || "your course";

  return (
    <div className="cr-gen-ink" role="status" aria-live="polite" aria-label="Course generation started">
      <div className="cr-gen-ink-inner">
        <p className="cr-kicker cr-gen-ink-kicker">Started</p>
        <motion.h1
          className="cr-gen-ink-title"
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
        >
          Writing {shown}
        </motion.h1>
        <motion.div
          className="cr-gen-ink-rule"
          initial={reduce ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
        <GenerationTheatre variant="ink" stage={stage} note={note} percent={percent} status={status} />
      </div>
    </div>
  );
}
