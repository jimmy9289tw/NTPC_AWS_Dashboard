"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Shared dimensions from the registered-population quadrant charts. */
export const quadrantPlot = { width: 620, height: 285, left: 72, right: 18, top: 26, bottom: 52 };
export function tooltipPosition(anchor: { left: number; top: number }, size: { width: number; height: number }, viewport: { width: number; height: number }) {
  const gap = 12, edge = 8;
  const left = Math.max(edge, Math.min(viewport.width - size.width - edge, anchor.left - size.width / 2));
  const above = anchor.top - size.height - gap;
  const top = above >= edge ? above : Math.min(anchor.top + gap, viewport.height - size.height - edge);
  return { left, top: Math.max(edge, top) };
}
export function QuadrantPointTooltip({ x, y, width, height, title, children, identity }: { x: number; y: number; width: number; height: number; title: ReactNode; children: ReactNode; identity: string }) {
  const anchor = useRef<HTMLSpanElement>(null), tooltip = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const update = () => {
      if (!anchor.current || !tooltip.current) return;
      const svg = anchor.current.parentElement?.querySelector("svg");
      if (!svg) return;
      const plot = svg.getBoundingClientRect(), frame = anchor.current.parentElement!.getBoundingClientRect();
      const point = { left: plot.left + x / width * plot.width, top: plot.top + y / height * plot.height }, box = tooltip.current.getBoundingClientRect();
      const position = tooltipPosition(point, box, { width: window.innerWidth, height: window.innerHeight });
      Object.assign(tooltip.current.style, { left: position.left + "px", top: position.top + "px", visibility: point.top < 0 || point.top > window.innerHeight || point.left < Math.max(0, frame.left) || point.left > Math.min(window.innerWidth, frame.right) ? "hidden" : "visible" });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
  }, [x, y, width, height, title, children, identity]);
  return <><span ref={anchor} aria-hidden="true" style={{ position: "absolute", left: x / width * 100 + "%", top: y / height * 100 + "%", pointerEvents: "none" }} />{typeof document !== "undefined" && createPortal(<div ref={tooltip} className="chart-point-tooltip chart-tooltip-portal" role="status"><strong>{title}</strong><span>{children}</span><small>{identity}</small></div>, document.body)}</>;
}
