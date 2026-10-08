import { useLayoutEffect, useRef, useState } from "react";

/** the rendered width of an element, kept up to date, so charts can draw at their true pixel size
 *  (text then stays the size we set instead of shrinking or growing with the box) */
export function useWidth<T extends HTMLElement>(fallback = 300) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}
