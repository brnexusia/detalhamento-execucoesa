import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { Route } from "../vendor/screenshot-to-spark-0332/src/routes/index";
import "../vendor/screenshot-to-spark-0332/src/styles.css";

// A LP vem diretamente de src/routes/index.tsx do projeto original, sem reescrever seu JSX.
const OriginalLanding = Route.options.component as ComponentType | undefined;
if (!OriginalLanding) throw new Error("O componente original da landing page não foi encontrado.");

const logoFallbacks: Record<string, string> = {
  "shopvax-horizontal-cor-negativo.png": "/brand/shopvax-wordmark-light.svg",
  "shopvax-horizontal-cor-positivo.png": "/brand/shopvax-lockup.svg",
  "shopvax-vertical-cor-negativo.png": "/brand/shopvax-wordmark-light.svg",
  "shopvax-favicon-512.png": "/brand/shopvax-symbol.svg",
};
// O Lovable guarda as quatro marcas em asset storage, não como PNGs no Git.
// Em caso de indisponibilidade desse storage, preserva o layout com a marca oficial do ShopVax.
window.addEventListener("error", (event) => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement)) return;
  const key = Object.keys(logoFallbacks).find((name) => img.currentSrc.includes(name));
  if (key && !img.src.endsWith(logoFallbacks[key])) img.src = logoFallbacks[key];
}, true);

createRoot(document.getElementById("root")!).render(<StrictMode><OriginalLanding /></StrictMode>);
