import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing root element");
}

const root = createRoot(rootElement);

// The current R3F Canvas schedules GPU disposal after unmount. StrictMode's
// development effect replay can destroy the remounted renderer while the
// Cinematic composer is attaching. Keep one root lifecycle; Canvas already
// owns disposal and LibraryScene handles actual context loss and recovery.
root.render(<App />);
