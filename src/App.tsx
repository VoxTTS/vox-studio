import { useEffect } from "react";
import { Shell } from "@/app/Shell";
import { useApp } from "@/app/store";
import { Toasts } from "@/components/Toasts";
import { EditorPage } from "@/editor/EditorPage";
import { ApiKeyPage } from "@/pages/ApiKeyPage";
import { AudiobookPage } from "@/pages/AudiobookPage";
import { LibraryPage } from "@/pages/LibraryPage";
import { LocalModelsPage } from "@/pages/LocalModelsPage";
import { PodcastPage } from "@/pages/PodcastPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { SpeechPage } from "@/pages/SpeechPage";
import { TranscribePage } from "@/pages/TranscribePage";
import { VoicesPage } from "@/pages/VoicesPage";

const PAGES = {
  speech: SpeechPage,
  podcast: PodcastPage,
  audiobook: AudiobookPage,
  transcribe: TranscribePage,
  voices: VoicesPage,
  library: LibraryPage,
  projects: ProjectsPage,
  editor: EditorPage,
  models: LocalModelsPage,
  key: ApiKeyPage,
};

export default function App() {
  const route = useApp((s) => s.route);
  useEffect(() => {
    useApp.getState().init();
  }, []);
  const Page = PAGES[route];
  return (
    <>
      <Shell>
        {route === "editor" ? (
          <Page />
        ) : (
          <div className="h-full overflow-y-auto">
            <Page />
          </div>
        )}
      </Shell>
      <Toasts />
    </>
  );
}
