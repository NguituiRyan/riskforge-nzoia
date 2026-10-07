import { useEffect, useRef } from "react";
import gsap from "gsap";

/** Tweens a number to its new value whenever it changes. */
export default function AnimatedValue({ value, format }: { value: number; format: (n: number) => string }) {
  const el = useRef<HTMLSpanElement>(null);
  const current = useRef(value);

  useEffect(() => {
    const state = { v: current.current };
    const tween = gsap.to(state, {
      v: value,
      duration: 0.9,
      ease: "power2.out",
      onUpdate: () => {
        if (el.current) el.current.textContent = format(state.v);
      },
      onComplete: () => {
        current.current = value;
      },
    });
    return () => {
      tween.kill();
      current.current = state.v;
    };
  }, [value, format]);

  return <span ref={el}>{format(value)}</span>;
}
