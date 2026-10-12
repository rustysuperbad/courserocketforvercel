import { motion } from "motion/react";
import { usePrefersReducedMotion } from "../lib/motionPref";
import { THEATRE_STEPS, theatreIndexFromStage } from "../data/scriptedDemos";

type Props = {
  stage?: string;
  note?: string;
  percent?: number;
  status?: string;
};

export default function GenerationTheatre({ stage, note, percent = 0, status }: Props) {
  const reduce = usePrefersReducedMotion();
  const active = status === "failed" || status === "blocked" ? 3 : theatreIndexFromStage(stage);
  const label = THEATRE_STEPS[active]?.label ?? "Working";

  return (
    <section className="cr-theatre" aria-label="Course generation">
      <div className="cr-theatre-island">
        <span className="cr-theatre-dot" aria-hidden="true" />
        <span>{status === "failed" ? "Stopped" : status === "blocked" ? "Waiting on sources" : label}</span>
        <span className="cr-kind">{Math.round(percent)}%</span>
      </div>
      <ol className="cr-theatre-steps">
        {THEATRE_STEPS.map((step, index) => {
          const state = index < active ? "is-done" : index === active ? "is-now" : "";
          return (
            <motion.li
              key={step.id}
              className={"cr-theatre-step " + state}
              animate={reduce ? undefined : { opacity: index <= active ? 1 : 0.45 }}
            >
              <span aria-hidden="true">{index < active ? "—" : index === active ? "▸" : "·"}</span>
              <span>
                <b style={{ display: "block", fontWeight: 600 }}>{step.label}</b>
                <small>{index === active && note ? note : step.detail}</small>
              </span>
            </motion.li>
          );
        })}
      </ol>
    </section>
  );
}
