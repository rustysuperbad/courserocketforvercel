import { motion } from "motion/react";
import { usePrefersReducedMotion } from "../lib/motionPref";
import { THEATRE_STEPS, theatreIndexFromStage } from "../data/scriptedDemos";

type Props = {
  stage?: string;
  note?: string;
  percent?: number;
  status?: string;
  variant?: "paper" | "ink";
};

export default function GenerationTheatre({ stage, note, percent = 0, status, variant = "paper" }: Props) {
  const reduce = usePrefersReducedMotion();
  const active = status === "failed" || status === "blocked" ? 3 : theatreIndexFromStage(stage);
  const label = THEATRE_STEPS[active]?.label ?? "Working";
  const shown = Math.max(0, Math.min(100, Math.round(percent)));

  return (
    <section className={"cr-theatre" + (variant === "ink" ? " is-ink" : "")} aria-label="Course generation">
      <div className="cr-theatre-island">
        <span className="cr-theatre-dot" aria-hidden="true" />
        <span>{status === "failed" ? "Stopped" : status === "blocked" ? "Still gathering material" : label}</span>
        <span className="cr-kind">{shown}%</span>
      </div>
      <div className="cr-theatre-meter" aria-hidden="true">
        <i style={{ width: `${Math.max(6, shown)}%` }} />
      </div>
      <ol className="cr-theatre-steps">
        {THEATRE_STEPS.map((step, index) => {
          const state = index < active ? "is-done" : index === active ? "is-now" : "";
          return (
            <motion.li
              key={step.id}
              className={"cr-theatre-step " + state}
              animate={reduce ? undefined : { opacity: index <= active ? 1 : 0.38 }}
            >
              <span aria-hidden="true">{index < active ? "✓" : index === active ? "▸" : "·"}</span>
              <span>
                <b>{step.label}</b>
                <small>{index === active && note ? note : step.detail}</small>
              </span>
            </motion.li>
          );
        })}
      </ol>
    </section>
  );
}
