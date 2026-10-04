import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./legacy-workspace.css";
import "./styles.css";
import "./student-workspace.css";
import "./account-workspace.css";
import "./student-layout.css";
import "./teacher-layout.css";
import "./student-design.css";
import "./teacher-design.css";
import "./student-frontpage.css";
import "./student-submission.css";

const base = import.meta.env.BASE_URL || "/";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={base}>
      <App />
    </BrowserRouter>
  </StrictMode>
);
