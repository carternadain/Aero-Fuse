"use client";

// Phones: while a text field has focus, the on-screen keyboard owns the bottom of the screen.
// Flag that on <html data-kbd> (CSS hides the floating tab bar) and keep the field in view.

const TEXTY = /^(text|search|email|url|tel|password|number|date|datetime-local|month|time)$/;

function isTyping(el: EventTarget | null): el is HTMLElement {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && TEXTY.test(el.type);
}

function reveal(el: HTMLElement) {
  const vv = window.visualViewport;
  const bottom = vv ? vv.height + vv.offsetTop : window.innerHeight;
  const r = el.getBoundingClientRect();
  if (r.bottom > bottom - 16 || r.top < 80) el.scrollIntoView({ block: "center", behavior: "smooth" });
}

export function registerKeyboardAssist() {
  if (!window.matchMedia?.("(pointer: coarse)").matches) return () => {};
  const root = document.documentElement;
  let t: ReturnType<typeof setTimeout> | undefined;
  const onIn = (e: FocusEvent) => {
    if (!isTyping(e.target)) return;
    const el = e.target;
    root.dataset.kbd = "";
    clearTimeout(t);
    t = setTimeout(() => reveal(el), 320); // after the keyboard has slid up
  };
  const onOut = () => {
    clearTimeout(t);
    // focus often hops straight to the next field; only drop the flag if nothing typed-into has it
    setTimeout(() => { if (!isTyping(document.activeElement)) delete root.dataset.kbd; }, 0);
  };
  const onResize = () => { if (isTyping(document.activeElement)) reveal(document.activeElement); };
  document.addEventListener("focusin", onIn);
  document.addEventListener("focusout", onOut);
  window.visualViewport?.addEventListener("resize", onResize);
  return () => {
    document.removeEventListener("focusin", onIn);
    document.removeEventListener("focusout", onOut);
    window.visualViewport?.removeEventListener("resize", onResize);
  };
}
