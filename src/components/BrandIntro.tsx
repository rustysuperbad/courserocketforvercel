import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { usePrefersReducedMotion } from "../lib/motionPref";

const KEY = "cr_intro_seen";

export default function BrandIntro() {
  const reduce = usePrefersReducedMotion();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (reduce) return;
    try {
      if (sessionStorage.getItem(KEY)) return;
    } catch { return; }
    setOpen(true);
    const timer = window.setTimeout(() => close(), 1200);
    return () => window.clearTimeout(timer);
  }, [reduce]);

  function close() {
    setOpen(false);
    try { sessionStorage.setItem(KEY, "1"); } catch { /* private mode */ }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="cr-intro"
          role="dialog"
          aria-label="CourseRocket"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } }}
        >
          <motion.div
            className="cr-intro-lockup"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <img src="/logo-mark.png" alt="" width={48} height={48} className="cr-intro-mark" />
            <span className="cr-intro-word">courserocket</span>
          </motion.div>
          <button type="button" className="cr-intro-skip" onClick={close}>Skip</button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
