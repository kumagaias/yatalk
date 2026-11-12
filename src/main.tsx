import React from "react";
import { createRoot } from "react-dom/client";
import { AgStudioAiModule } from "ag-studio";
import { AgStudioProvider } from "ag-studio-react";
import { App } from "./app/App";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/responsive.css";
import "./styles/owner-assistant.css";
import "./styles/ag-analytics.css";
import "./styles/order-flow.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AgStudioProvider modules={[AgStudioAiModule]}>
      <App />
    </AgStudioProvider>
  </React.StrictMode>,
);
