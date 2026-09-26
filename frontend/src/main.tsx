import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./legacy-workspace.css";
import "./styles.css";
import "./student-workspace.css";
import "./account-workspace.css";

const base = import.meta.env.BASE_URL || "/";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={base}>
      <App />
    </BrowserRouter>
  </StrictMode>
);
