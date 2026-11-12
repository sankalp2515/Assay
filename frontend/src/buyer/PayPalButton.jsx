// The official PayPal button, rendered by PayPal's own JavaScript SDK (Sandbox only).
// The browser only ever holds the public client id. The order is created by our server
// and confirmed by our server; this component never builds an order or reads a result
// from PayPal as proof of payment.
import { useEffect, useRef, useState } from "react";
import { paypalSdkUrl } from "../domain.js";

export { paypalSdkUrl };

const loaders = new Map();

function loadSdk(src) {
  if (!loaders.has(src))
    loaders.set(
      src,
      new Promise((resolve, reject) => {
        const el = document.createElement("script");
        el.src = src;
        el.async = true;
        el.onload = () => (window.paypal?.Buttons ? resolve(window.paypal) : reject(new Error("PayPal did not load.")));
        el.onerror = () => {
          loaders.delete(src);
          el.remove();
          reject(new Error("PayPal could not be reached."));
        };
        document.head.appendChild(el);
      }),
    );
  return loaders.get(src);
}

/**
 * @param {{ config: object, currency?: string, disabled?: boolean, createOrder: () => Promise<string>,
 *   onApprove: () => Promise<void>, onCancel?: () => void, onError?: (e: Error) => void,
 *   onUnavailable?: () => void }} props
 */
export function PayPalButton({ config, currency = "USD", disabled = false, createOrder, onApprove, onCancel, onError, onUnavailable }) {
  const host = useRef(null);
  const actions = useRef(null);
  const handlers = useRef({});
  handlers.current = { createOrder, onApprove, onCancel, onError, onUnavailable };
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const [state, setState] = useState("loading");
  const src = paypalSdkUrl(config, currency);

  useEffect(() => {
    if (!src) {
      setState("unavailable");
      handlers.current.onUnavailable?.();
      return;
    }
    let live = true;
    let buttons;
    setState("loading");
    loadSdk(src)
      .then((paypal) => {
        if (!live || !host.current) return;
        buttons = paypal.Buttons({
          style: { layout: "horizontal", color: "gold", shape: "rect", label: "paypal", height: 48, tagline: false },
          onInit(_data, a) {
            actions.current = a;
            if (disabledRef.current) a.disable();
          },
          createOrder: () => handlers.current.createOrder(),
          onApprove: () => handlers.current.onApprove(),
          onCancel: () => handlers.current.onCancel?.(),
          onError: (e) => handlers.current.onError?.(e instanceof Error ? e : new Error("PayPal reported a problem. No charge is inferred.")),
        });
        if (!buttons.isEligible()) throw new Error("PayPal is not available here.");
        return buttons.render(host.current).then(() => live && setState("ready"));
      })
      .catch(() => {
        if (!live) return;
        setState("unavailable");
        handlers.current.onUnavailable?.();
      });
    return () => {
      live = false;
      actions.current = null;
      buttons?.close?.().catch(() => {});
    };
  }, [src]);

  useEffect(() => {
    if (!actions.current) return;
    if (disabled) actions.current.disable();
    else actions.current.enable();
  }, [disabled, state]);

  if (state === "unavailable") return null;
  return (
    <div className="paypal-sdk" data-state={state} data-disabled={disabled || undefined}>
      <div ref={host} className="paypal-sdk-host" />
      {state === "loading" && <p className="paypal-sdk-note" role="status">Loading the PayPal button…</p>}
      {state === "ready" && disabled && <p className="paypal-sdk-note">Tick the agreement above to enable PayPal.</p>}
    </div>
  );
}
