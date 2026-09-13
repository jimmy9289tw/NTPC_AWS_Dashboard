"use client";

import { forwardRef, useCallback, useLayoutEffect, useRef, useState, type HTMLAttributes } from "react";

type AxisLabel = { text: string; x?: string; y?: string; transform?: string; anchor: string };
type PinnedAxis = { start: number; width: number; height: number; plotBottom: number; pixels: number; labels: AxisLabel[]; side: "left" | "right" };

export function chartReadingScale(width: number, available: number) {
  const minimum = Math.ceil(width * .875); // A 16-unit tick stays at least 14px.
  return { minimum, overflow: available < minimum };
}

export function chartLabelLines(label: string, length = 12) {
  const characters = Array.from(label);
  return Array.from({ length: Math.ceil(characters.length / length) }, (_, index) => characters.slice(index * length, (index + 1) * length).join(""));
}

export function isNumericAxis(labels: { text: string }[]) {
  return labels.filter(label => /^[−-]?\d[\d,]*(?:\.\d+)?%?$/.test(label.text.trim())).length >= 2;
}

/** One scroll area, stationary axes and a tap readout; the original SVG owns all data and motion. */
export const ChartCanvas = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function ChartCanvas(
  { children, className = "", style, onClickCapture, onFocusCapture, ...props }, forwardedRef,
) {
  const root = useRef<HTMLDivElement>(null);
  const [axes, setAxes] = useState<PinnedAxis[]>([]);
  const [overflow, setOverflow] = useState(false);
  const [readout, setReadout] = useState("");
  const [pending, setPending] = useState(false);
  const assignRef = useCallback((node: HTMLDivElement | null) => {
    root.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);
  useLayoutEffect(() => {
    const element = root.current, svg = element?.querySelector("svg");
    if (!element || !svg) return;
    const refresh = () => {
      const box = svg.viewBox.baseVal;
      if (!box.width || !box.height) return;
      const layout = chartReadingScale(box.width, element.clientWidth);
      svg.style.minWidth = layout.minimum + "px";
      const rect = svg.getBoundingClientRect();
      const scrolls = element.scrollWidth > element.clientWidth + 1;
      setOverflow(scrolls);
      const vertical = [...svg.querySelectorAll("line.axis-line")].filter(line =>
        line.getAttribute("x1") === line.getAttribute("x2") &&
        Math.abs(Number(line.getAttribute("y2")) - Number(line.getAttribute("y1"))) > box.height / 4);
      const positions = [...new Set(vertical.map(line => Number(line.getAttribute("x1"))))].sort((a,b) => a-b);
      const next = !scrolls || !positions.length ? [] : positions.filter((_,i) => i === 0 || i === positions.length - 1).map((position, index): PinnedAxis => {
        const side = index === 0 ? "left" : "right", start = side === "left" ? 0 : position - 1;
        const width = side === "left" ? position + 1 : box.width - start;
        const labels = [...svg.querySelectorAll("text")].filter(label => {
          const transform = label.getAttribute("transform") ?? "";
          const x = Number(label.getAttribute("x") ?? transform.match(/translate\(\s*([\d.]+)/)?.[1]);
          return Number.isFinite(x) && (side === "left" ? x < position : x > position);
        }).map(label => ({ text: label.textContent ?? "", x: label.getAttribute("x") ?? undefined, y: label.getAttribute("y") ?? undefined, transform: label.getAttribute("transform") ?? undefined, anchor: label.getAttribute("text-anchor") ?? "start" }));
        const plotBottom = Math.max(...vertical.flatMap(line => [Number(line.getAttribute("y1")), Number(line.getAttribute("y2"))]));
        return { start, width, height: box.height, plotBottom, pixels: rect.width / box.width, labels, side };
      }).filter(axis => isNumericAxis(axis.labels));
      setAxes(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const updatePending = () => { const waiting = element.dataset.valuesPending === "true"; setPending(waiting); if (waiting) setReadout(""); };
    refresh(); updatePending();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(refresh);
    resize?.observe(element);
    const content = new MutationObserver(refresh);
    content.observe(svg, { childList: true, characterData: true, subtree: true });
    const motion = new MutationObserver(updatePending);
    motion.observe(element, { attributes: true, attributeFilter: ["data-values-pending"] });
    window.addEventListener("resize", refresh);
    return () => { resize?.disconnect(); content.disconnect(); motion.disconnect(); window.removeEventListener("resize", refresh); };
  }, [children]);
  const captureValue = (target: EventTarget) => {
    if (!(target instanceof Element) || !root.current || root.current.dataset.valuesPending === "true") return;
    const mark = target.closest("svg [aria-label]");
    if (mark && root.current.contains(mark)) setReadout(mark.getAttribute("aria-label") ?? "");
  };
  return <div className="readable-chart">
    <div className="readable-plot-frame">
      {/* The overflow region must be keyboard-focusable so arrow keys can scroll it. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div {...props} ref={assignRef} className={className + " readable-plot-scroll"} style={{ ...style, minWidth: 0 }} role="region" tabIndex={0} aria-label={props["aria-label"] ?? "分析圖表；可點選數值，窄畫面可左右捲動"}
        onClickCapture={event => { captureValue(event.target); onClickCapture?.(event); }}
        onFocusCapture={event => { captureValue(event.target); onFocusCapture?.(event); }}>{children}</div>
      {axes.map(axis => <svg key={axis.side} className={"chart-pinned-axis " + axis.side} aria-hidden="true" viewBox={`${axis.start} 0 ${axis.width} ${axis.height}`} style={{ width: axis.width * axis.pixels, height: axis.height * axis.pixels }}><rect x={axis.start} width={axis.width} height={axis.plotBottom + 2} fill="var(--plot-surface, white)" />{axis.labels.map((label,index) => <text key={index} x={label.x} y={label.y} transform={label.transform} textAnchor={label.anchor as "start" | "middle" | "end"}>{label.text}</text>)}</svg>)}
    </div>
    <p className="chart-reading-guide" role="status" aria-live="polite">{pending ? "圖表更新中…完成後顯示數值。" : overflow ? axes.length ? "左右滑動看完整比較；數值軸固定。點選長條或資料點看數值。" : "左右滑動看完整比較。點選長條或資料點看數值。" : "點選長條或資料點查看數值。"}</p>
    {readout && !pending && <p className="chart-tap-readout" role="status">{readout}</p>}
  </div>;
});
