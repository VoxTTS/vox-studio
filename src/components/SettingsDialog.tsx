import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import { clearVoiceCatalogs } from "./VoiceInput";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";

export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen);
  const settings = useStore((s) => s.settings);
  const { setSettingsOpen, setSettings, toast } = useStore.getState();
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [tested, setTested] = useState<string | null>(null);
  const [cache, setCache] = useState<Awaited<ReturnType<typeof api.cache>> | null>(null);

  useEffect(() => {
    if (!open) return;
    setKey("");
    setTested(null);
    setBaseUrl(settings?.baseUrl ?? "");
    api.cache().then(setCache).catch(() => setCache(null));
  }, [open, settings?.baseUrl]);

  const save = async () => {
    setBusy("save");
    try {
      const next = await api.saveSettings({ ...(key ? { apiKey: key } : {}), baseUrl });
      setSettings(next);
      clearVoiceCatalogs();
      setKey("");
      toast("Settings saved locally.", "info");
      return next;
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    if (key || baseUrl !== settings?.baseUrl) await save();
    setBusy("test");
    setTested(null);
    try {
      const r = await api.testKey();
      setTested(`Connected — ${Array.isArray(r.models) ? r.models.length : "?"} models available.`);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setSettingsOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" /> VoxTTS connection
          </DialogTitle>
          <DialogDescription>
            Your key is stored only in this machine's local SQLite database and is sent only to the VoxTTS API from the local server
            — never to the browser.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5">
          <Label htmlFor="api-key">VOXTTS_API_KEY</Label>
          <Input
            id="api-key"
            type="password"
            autoComplete="off"
            placeholder={settings?.hasKey ? `Saved: ${settings.keyHint} (${settings.keySource})` : "vox_sk_…"}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="font-mono"
          />
          <p className="text-[11px] text-muted-foreground">
            Create one at{" "}
            <a href="https://voxtts.app/dashboard" target="_blank" rel="noreferrer" className="text-primary hover:underline">
              voxtts.app/dashboard
            </a>
            . Testing calls <code>GET /api/v1/models</code>, which costs no characters.
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="base-url">API base URL</Label>
          <Input id="base-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="font-mono" />
        </div>

        {tested && (
          <p className="flex items-center gap-1.5 text-xs text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> {tested}
          </p>
        )}

        <div className="flex items-center gap-2">
          {settings?.keySource === "saved" && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={async () => {
                setSettings(await api.saveSettings({ apiKey: "" }));
                clearVoiceCatalogs();
              }}
            >
              Remove saved key
            </Button>
          )}
          <Button variant="outline" className="ml-auto" disabled={!!busy} onClick={test}>
            {busy === "test" && <Loader2 className="animate-spin" />} Test connection
          </Button>
          <Button disabled={!!busy || (!key && baseUrl === settings?.baseUrl)} onClick={save}>
            {busy === "save" && <Loader2 className="animate-spin" />} Save
          </Button>
        </div>

        {cache && (
          <div className="flex items-center gap-3 rounded-md border bg-background/40 p-2.5 text-[11px] text-muted-foreground">
            <div className="flex-1">
              <div className="font-medium text-foreground">Render cache</div>
              {cache.files} files · {(cache.bytes / 1e6).toFixed(1)} MB · {cache.saved.toLocaleString()} chars saved by cache hits
              <div className="truncate font-mono text-[10px]" title={cache.dir}>
                {cache.dir}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                if (!confirm("Delete every cached render? Re-rendering will spend characters again.")) return;
                await api.clearCache();
                setCache(await api.cache());
                const p = useStore.getState().project;
                if (p) await useStore.getState().openProject(p.id);
              }}
            >
              Clear
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
