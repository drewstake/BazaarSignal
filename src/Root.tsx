import { useEffect, useState } from "react";
import App from "./App";
import MarketApp from "./companion/MarketApp";
import "./companion/simplified.css";
export default function Root() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const change = () => setHash(location.hash);
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const params = new URLSearchParams(hash.slice(1));
  return params.has("item") ||
    params.has("disable") ||
    params.has("alerts") ||
    params.has("legacy") ? (
    <App />
  ) : (
    <MarketApp />
  );
}
