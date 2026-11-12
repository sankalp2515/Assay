// PayPal's official logos, loaded unmodified from PayPal (paypalobjects.com). We never
// redraw, recolour, crop or stretch them. On the Darkroom theme they sit on a white chip
// so PayPal's colours stay as published. Text alternatives always say "PayPal".
const SRC = {
  full: "https://www.paypalobjects.com/paypal-ui/logos/svg/paypal-color.svg",
  mark: "https://www.paypalobjects.com/paypal-ui/logos/svg/paypal-mark-color.svg",
};

export function PayPalLogo({ variant = "full", size = "md", className = "" }) {
  return (
    <span className={`pp-logo pp-${variant} pp-${size} ${className}`.trim()}>
      <img src={SRC[variant]} alt="PayPal" decoding="async" referrerPolicy="no-referrer" />
    </span>
  );
}

// For short labels and headings only: the word "PayPal" becomes the logo. Running prose
// keeps the word, so sentences stay readable and searchable.
export function withPayPal(text, { size = "sm", variant = "full" } = {}) {
  if (typeof text !== "string" || !text.includes("PayPal")) return text;
  const parts = text.split("PayPal");
  return parts.flatMap((part, i) =>
    i === 0 ? [part] : [<PayPalLogo key={i} size={size} variant={variant} />, part],
  );
}
