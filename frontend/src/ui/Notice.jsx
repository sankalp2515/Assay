import { useEffect, useRef, useState } from "react";
import { CheckCircleIcon, XIcon } from "@phosphor-icons/react";
export function Notice({ message, onClose }) {
  const [retained, setRetained] = useState(message || "");
  const trigger = useRef(null);
  useEffect(() => {
    if (message) {
      setRetained(message);
      if (!document.activeElement?.closest(".toast"))
        trigger.current = document.activeElement;
    }
  }, [message]);
  return (
    <div
      className="toast"
      data-open={!!message}
      inert={!message ? true : undefined}
      aria-hidden={!message}
    >
      <CheckCircleIcon size={19} aria-hidden="true" />
      <span>{message || retained}</span>
      <button
        className="icon-button"
        aria-label="Dismiss notification"
        onClick={() => {
          onClose();
          if (trigger.current?.isConnected) trigger.current.focus();
        }}
      >
        <XIcon size={17} />
      </button>
    </div>
  );
}
