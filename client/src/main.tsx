import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import MissionControl from "./MissionControl";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MissionControl />
  </StrictMode>
);
