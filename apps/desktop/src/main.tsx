import { SYSTEM_VERSION } from "@project-online/domain";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { DesktopApp } from "./app/DesktopApp.js";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Desktop application root is missing");
}

document.title = `项目管理线上版 ${SYSTEM_VERSION}`;

createRoot(root).render(
  <StrictMode>
    <DesktopApp />
  </StrictMode>
);
