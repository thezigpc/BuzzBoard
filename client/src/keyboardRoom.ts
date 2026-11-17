import { useEffect } from "react";
import { KEYBOARD_VAR, useOnScreenKeyboard } from "@bargames/gamekit/client";

const GAP = 12;

/**
 * Kit 0.10.3's on-screen keyboard covers the bottom of the screen (on touchscreens with no
 * keyboard of their own). The kit pads the page and keeps the field in view; this also
 * keeps the field's form button (Join, Lock it in, Send) above the keys, so a short form
 * near the bottom isn't half hidden. Does nothing where the keyboard never shows.
 */
export function useKeepFormAboveKeyboard(): void {
  const on = useOnScreenKeyboard();
  useEffect(() => {
    if (!on) return;
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      // After the kit has set the keyboard's height for this field.
      frame = requestAnimationFrame(() => {
        const kb = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(KEYBOARD_VAR)) || 0;
        const field = document.activeElement;
        if (!kb || !(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) || !field.form) return;
        const button = field.form.querySelector<HTMLElement>('button:not([type="button"]), input[type="submit"]');
        const target = button ?? field;
        const over = target.getBoundingClientRect().bottom + GAP - (window.innerHeight - kb);
        // Scroll up only as far as the field itself stays on screen.
        const room = field.getBoundingClientRect().top - GAP;
        if (over > 0) window.scrollBy({ top: Math.min(over, Math.max(room, 0)) });
      });
    };
    const style = new MutationObserver(fit); // the kit sets the height on <html>'s style
    style.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    document.addEventListener("focusin", fit);
    return () => {
      cancelAnimationFrame(frame);
      style.disconnect();
      document.removeEventListener("focusin", fit);
    };
  }, [on]);
}
