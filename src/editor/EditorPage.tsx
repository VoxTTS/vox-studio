import { useEffect } from "react";
import { EditorBar } from "./EditorBar";
import { Inspector } from "./Inspector";
import { MasterDialog } from "./MasterDialog";
import { Timeline } from "./Timeline";
import { Transport } from "./Transport";
import { useStore } from "./store";

function isTyping(el: EventTarget | null) {
  return el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

/** The multi-track timeline editor add-on. */
export function EditorPage() {
  useEffect(() => {
    useStore.getState().init();
    return () => useStore.getState().stop();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (s.masterOpen || document.querySelector("[role=dialog]")) return;
      if (e.key === "Escape") return s.select(null);
      if (isTyping(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault();
        s.togglePlay();
      } else if ((e.key === "Delete" || e.key === "Backspace") && s.selection?.kind === "segment") {
        e.preventDefault();
        s.deleteSegment(s.selection.id);
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && s.selection?.kind === "segment") {
        e.preventDefault();
        s.renderSegment(s.selection.id, "preview", { play: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full min-w-0 flex-col">
      <EditorBar />
      <Transport />
      <Timeline />
      <Inspector />
      <MasterDialog />
    </div>
  );
}
