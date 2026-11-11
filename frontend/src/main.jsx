import React from "react";
import { createRoot } from "react-dom/client";
import { Workspace } from "./Workspace.jsx";
import "./styles.css";
import "./styles/system.css";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "./styles/assay.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Workspace />
  </React.StrictMode>,
);
