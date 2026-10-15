import React from "react";
import ReactDOM from "react-dom/client";
import App from "./Root";
import ViewBoundary from "./ViewBoundary";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ViewBoundary><App /></ViewBoundary>
  </React.StrictMode>,
);
