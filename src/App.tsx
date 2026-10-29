import { useEffect } from "react";
import { Inspector } from "@/components/Inspector";
import { MasterDialog } from "@/components/MasterDialog";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Timeline } from "@/components/Timeline";
import { Toasts } from "@/components/Toasts";
import { TopBar } from "@/components/TopBar";
import { Transport } from "@/components/Transport";
import { useStore } from "@/lib/store";

function isTyping(el: EventTarget | null) {
  return el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

export default function App() {
  useEffect(() => {
    useStore.getState().init();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (s.settingsOpen || s.masterOpen) return;
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
    <div className="flex h-full flex-col">
      <TopBar />
      <Transport />
      <Timeline />
      <Inspector />
      <SettingsDialog />
      <MasterDialog />
      <Toasts />
    </div>
  );
}
