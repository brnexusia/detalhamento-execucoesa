import { useEffect, useState } from "react";
import logo from "@/assets/shopvax-horizontal-cor-positivo.png.asset.json";

/**
 * Abertura: o mesmo arquivo oficial da logo é recortado (clip-path) em três camadas —
 * V (metade superior do símbolo), A (metade inferior) e a palavra SHOPVAX.
 * A geometria nunca é redesenhada; as camadas se sobrepõem pixel a pixel.
 */
export function Intro() {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => setDone(true), reduced ? 900 : 2000);
    return () => clearTimeout(t);
  }, []);
  if (done) return null;
  const layer = "absolute inset-0 h-full w-full";
  return (
    <div className="intro fixed inset-0 z-[100] grid place-items-center bg-background" aria-hidden>
      <div className="intro-group relative aspect-[2000/731] w-[min(78vw,560px)]">
        <img src={logo.url} alt="" className={`${layer} intro-v`} style={{ clipPath: "inset(0 73% 50% 0)" }} />
        <img src={logo.url} alt="" className={`${layer} intro-a`} style={{ clipPath: "inset(50% 73% 0 0)" }} />
        <img src={logo.url} alt="" className={`${layer} intro-word`} />
      </div>
    </div>
  );
}
