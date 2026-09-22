import { useEffect, useRef, useState } from "react";

/**
 * A number that glides to each new value instead of jumping; still for people who turn motion off.
 * It chases the target each frame rather than restarting per change, so a target that moves every
 * frame (a fast replay) is still followed.
 */
export function useCountUp(target: number, duration = 450) {
  const [value, setValue] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      current.current = target;
      setValue(target);
      return;
    }
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.max(0, now - last);
      last = now;
      // Closes about 95% of the gap in `duration`, however often the target moves.
      const next =
        current.current + (target - current.current) * (1 - Math.exp((-3 * dt) / duration));
      current.current =
        Math.abs(target - next) < 0.005 * Math.max(1, Math.abs(target)) ? target : next;
      setValue(current.current);
      if (current.current !== target) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}
