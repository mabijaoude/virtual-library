import { useLayoutEffect, type RefObject } from "react";

/** Keep a modal's covered siblings out of both keyboard and assistive navigation. */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, returnSelector?: string, enabled = true) {
  useLayoutEffect(() => {
    if (!enabled) return;
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const covered = new Map<HTMLElement, boolean>();
    let child: HTMLElement = dialog;
    while (child.parentElement && child !== document.body) {
      for (const sibling of child.parentElement.children) {
        if (sibling !== child && sibling instanceof HTMLElement && !["SCRIPT", "STYLE"].includes(sibling.tagName) && !sibling.hasAttribute("data-dialog-backdrop")) {
          covered.set(sibling, sibling.inert);
          sibling.inert = true;
        }
      }
      child = child.parentElement;
    }
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href], [tabindex="0"]'
    )].filter((element) => !element.closest("[inert]") && element.getClientRects().length > 0);
    dialog.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (!first) {
        event.preventDefault();
        dialog.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
      covered.forEach((inert, element) => { element.inert = inert; });
      requestAnimationFrame(() => {
        // A shortcut or another panel may already have deliberately moved focus.
        const active = document.activeElement;
        if (active instanceof HTMLElement && active !== document.body && active.isConnected && !dialog.contains(active)) return;
        const target = previous?.isConnected && previous !== document.body
          ? previous
          : returnSelector?.split(",").map((selector) => document.querySelector<HTMLElement>(selector.trim())).find(Boolean);
        if (!document.querySelector('[role="dialog"][aria-modal="true"]') && target && !target.closest("[inert]")) target.focus({ preventScroll: true });
      });
    };
  }, [enabled, ref, returnSelector]);
}
