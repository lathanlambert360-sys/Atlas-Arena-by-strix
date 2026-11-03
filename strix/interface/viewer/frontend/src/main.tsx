import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import StrixCloud from "./StrixCloud";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StrixCloud />
  </StrictMode>
);
