"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const layers: HTMLElement[] = [];
let bodyOverflow = "";

export function modalFocusTarget(nodes: HTMLElement[], active: Element | null, backwards: boolean) {
  if (!nodes.length) return null;
  if (!nodes.includes(active as HTMLElement)) return backwards ? nodes.at(-1)! : nodes[0];
  if (backwards && active === nodes[0]) return nodes.at(-1)!;
  if (!backwards && active === nodes.at(-1)) return nodes[0];
  return null;
}

/** Shared keyboard/scroll lifecycle. A changed callback must not reopen or refocus a drawer. */
export function useModalInteraction(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  initialFocus?: RefObject<HTMLElement | null>,
) {
  const close = useRef(onClose);
  useLayoutEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const root = ref.current;
    if (!open || !root) return;
    const doc = root.ownerDocument, previous = doc.activeElement as HTMLElement | null;
    if (!layers.length) bodyOverflow = doc.body.style.overflow;
    layers.push(root);
    doc.body.style.overflow = "hidden";
    const focusable = () => [...root.querySelectorAll<HTMLElement>('button, a[href], input, textarea, select, summary, [tabindex]')]
      .filter(node => node.tabIndex >= 0 && !node.matches(":disabled") && !node.closest("[inert]") && node.getClientRects().length > 0);
    const focusFirst = () => (initialFocus?.current ?? focusable()[0] ?? root).focus();
    const isTop = () => layers.at(-1) === root;
    const onKey = (event: KeyboardEvent) => {
      if (!isTop()) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); return; }
      if (event.key !== "Tab") return;
      const nodes = focusable();
      const next = modalFocusTarget(nodes, doc.activeElement, event.shiftKey);
      if (next || !nodes.length) { event.preventDefault(); (next ?? root).focus(); }
    };
    const onFocus = (event: FocusEvent) => { if (isTop() && !root.contains(event.target as Node)) focusFirst(); };
    focusFirst();
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("focusin", onFocus);
    return () => {
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("focusin", onFocus);
      const index = layers.lastIndexOf(root), wasTop = isTop();
      if (index >= 0) layers.splice(index, 1);
      if (!layers.length) doc.body.style.overflow = bodyOverflow;
      if (wasTop && previous?.isConnected && !previous.closest("[hidden], [inert]")) previous.focus();
    };
  }, [open, ref, initialFocus]);
}
