"use client";

import { useLayoutEffect, useRef } from "react";

export const chartTransitionDuration = 2000;
export const chartValueRevealDelay = 2100;
export function chartMotionKey(...data: unknown[]): string { return JSON.stringify(data); }

type Attributes = Record<string, string>;
type Snapshot = Map<string, Attributes>;
const geometryAttributes = ["x", "y", "width", "height", "cx", "cy", "r", "x1", "x2", "y1", "y2", "d", "points"];
const numericPattern = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi;
const geometryFromJson = (value: string | undefined): Attributes => Object.fromEntries(Object.entries(JSON.parse(value ?? "{}")).map(([key, item]) => [key, String(item)]));

/** Interpolate only matching SVG geometry. Data and labels retain exact target values. */
export function interpolateGeometry(from: string, to: string, progress: number): string {
  if (progress >= 1 || from === to) return to;
  const start = from.match(numericPattern)?.map(Number) ?? [];
  const end = to.match(numericPattern)?.map(Number) ?? [];
  if (!start.length || start.length !== end.length || from.replace(numericPattern, "#") !== to.replace(numericPattern, "#")) return to;
  let index = 0;
  return to.replace(numericPattern, () => {
    const value = start[index] + (end[index] - start[index]) * Math.max(0, progress);
    index++;
    return String(value);
  });
}
function marksIn(element: Element) {
  const counts: Record<string, number> = {};
  return [...element.querySelectorAll<SVGElement>("svg rect, svg circle, svg path, svg polyline, svg polygon, svg line")].map(mark => {
    const tag = mark.tagName, index = counts[tag] ?? 0;
    counts[tag] = index + 1;
    return { key: mark.dataset.motionKey ?? tag + ":" + index, mark };
  });
}
function readAttributes(mark: SVGElement): Attributes {
  const attributes = Object.fromEntries(geometryAttributes.flatMap(name => mark.hasAttribute(name) ? [[name, mark.getAttribute(name)!]] : []));
  // React may skip an unchanged prop after a rapid re-selection. Keep its intended
  // endpoint separate from the intermediate attributes painted by this hook.
  return { ...attributes, ...geometryFromJson(mark.dataset.motionTarget) };
}

/** Value labels keep their space; axes, category labels and accessible names stay visible. */
export function deferChartValues(element: Element, reducedMotion: boolean) {
  if (reducedMotion) { element.removeAttribute("data-values-pending"); return () => {}; }
  element.setAttribute("data-values-pending", "true");
  const timer = setTimeout(() => element.removeAttribute("data-values-pending"), chartValueRevealDelay);
  return () => { clearTimeout(timer); element.removeAttribute("data-values-pending"); };
}

/** Retain painted geometry so a new selection can reverse an in-flight change. */
export function startChartTransition(element: Element, previous: Snapshot, reducedMotion: boolean, animateOnMount = false): { snapshot: Snapshot; cancel: (finish?: boolean) => void } {
  const marks = marksIn(element);
  const target = new Map(marks.map(({ key, mark }) => [key, readAttributes(mark)]));
  const current: Snapshot = new Map();
  const changes = marks.flatMap(({ key, mark }) => {
    const to = target.get(key)!;
    const from = previous.get(key) ?? (animateOnMount && mark.dataset.motionEnter ? { ...to, ...geometryFromJson(mark.dataset.motionEnter) } : undefined);
    current.set(key, { ...to });
    for (const [name, value] of Object.entries(to)) mark.setAttribute(name, value);
    if (!from || reducedMotion) return [];
    const attributes = Object.keys(to).filter(name => from[name] != null && from[name] !== to[name]);
    return attributes.length ? [{ key, mark, from, to, attributes }] : [];
  });
  if (!changes.length || typeof requestAnimationFrame !== "function") return { snapshot: current, cancel: () => {} };
  let frame = 0, start: number | null = null, cancelled = false;
  const paint = (progress: number) => {
    const eased = progress * progress * (3 - 2 * progress);
    for (const { key, mark, from, to, attributes } of changes) {
      for (const name of attributes) {
        const value = interpolateGeometry(from[name], to[name], eased);
        mark.setAttribute(name, value);
        current.get(key)![name] = value;
      }
    }
    // A changing monthly series can add/remove months. Derive its line from the
    // same painted points, so topology changes never separate dots from the line.
    for (const line of element.querySelectorAll<SVGPathElement>('path[data-motion-follow-points]')) {
      const series = line.dataset.motionFollowPoints;
      if (!series) continue;
      const dots = [...element.querySelectorAll<SVGCircleElement>('circle[data-motion-series]')].filter(dot => dot.dataset.motionSeries === series);
      if (dots.length) {
        const d = dots.map((dot, i) => `${i ? 'L' : 'M'}${dot.getAttribute('cx')},${dot.getAttribute('cy')}`).join(' ');
        line.setAttribute('d', d);
        const key = line.dataset.motionKey;
        if (key && current.has(key)) current.get(key)!.d = d;
      }
    }
  };
  paint(0);
  const tick = (now: number) => {
    if (cancelled) return;
    start ??= now;
    const progress = Math.min(1, (now - start) / chartTransitionDuration);
    paint(progress);
    if (progress < 1) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return { snapshot: current, cancel: (finish = false) => { cancelled = true; cancelAnimationFrame(frame); if (finish) paint(1); } };
}

export function useChartTransition<T extends HTMLElement | SVGElement = HTMLDivElement>(signature: string, animateOnMount = false) {
  const ref = useRef<T>(null);
  const previous = useRef<Snapshot>(new Map());
  const lastSignature = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const preference = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    const changed = lastSignature.current !== null && lastSignature.current !== signature;
    const revealValues = changed || animateOnMount ? deferChartValues(ref.current, preference?.matches ?? false) : () => {};
    lastSignature.current = signature;
    const motion = startChartTransition(ref.current, previous.current, preference?.matches ?? false, animateOnMount);
    previous.current = motion.snapshot;
    const onPreferenceChange = () => { if (preference?.matches) { motion.cancel(true); revealValues(); } };
    preference?.addEventListener?.("change", onPreferenceChange);
    return () => { motion.cancel(); revealValues(); preference?.removeEventListener?.("change", onPreferenceChange); };
  }, [signature, animateOnMount]);
  return ref;
}
