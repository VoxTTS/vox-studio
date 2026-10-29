import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, KeyRound, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { MODELS } from "@shared/directives.js";
import { fail, useApp } from "@/app/store";
import { Card, Field, PageHeader, formatBytes, timeAgo } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { Usage } from "@/lib/types";
import { clearVoiceCatalogs } from "@/lib/voices";

type TestResult = Awaited<ReturnType<typeof api.testKey>>;

export function ApiKeyPage() {
  const settings = useApp((s) => s.settings);
  const { setSettings, toast } = useApp.getState();
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);

  const loadUsage = () => api.usage().then(setUsage).catch(() => {});
  useEffect(() => void loadUsage(), []);
  useEffect(() => setBaseUrl(settings?.baseUrl ?? ""), [settings?.baseUrl]);

  const runTest = async () => {
    setBusy("test");
    setTest(null);
    try {
      setTest(await api.testKey());
    } catch (err) {
      fail(err);
    } finally {
      setSettings(await api.settings());
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    try {
      setSettings(await api.saveSettings({ ...(key ? { apiKey: key } : {}), baseUrl }));
      clearVoiceCatalogs();
      setKey("");
      toast("Saved on this computer.", "info");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
    void runTest();
  };

  const remove = async () => {
    if (!confirm("Remove the saved key from this computer?")) return;
    setBusy("remove");
    setSettings(await api.saveSettings({ apiKey: "" }));
    clearVoiceCatalogs();
    setTest(null);
    setBusy(null);
  };

  const check = settings?.lastCheck;
  const month = usage?.byModel.reduce((n, r) => n + (r.month || 0), 0) ?? 0;

  return (
    <div>
      <PageHeader
        title="API key"
        subtitle="Connect Vox Studio to your VoxTTS account. Local models work without a key."
        actions={
          <a href="https://voxtts.app/dashboard/api-keys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            Manage keys on voxtts.app <ExternalLink className="h-3 w-3" />
          </a>
        }
      />
      <div className="grid gap-5 p-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card className="space-y-4">
            <div className="flex items-center gap-3">
              <div className={`flex h-9 w-9 items-center justify-center rounded-full ${settings?.hasKey ? "bg-emerald-500/15 text-emerald-400" : "bg-destructive/15 text-destructive"}`}>
                <KeyRound className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{settings?.hasKey ? "Key saved" : "No key yet"}</div>
                <div className="font-mono text-[11px] text-muted-foreground" data-testid="key-hint">
                  {settings?.hasKey ? `${settings.keyHint} · ${settings.keySource === "env" ? "from VOXTTS_API_KEY" : "stored in data/vox-studio.db"}` : "Create one under API keys on voxtts.app (Pro, Scale or On demand)."}
                </div>
              </div>
              {check && (
                <span className={`flex items-center gap-1 text-[11px] ${check.ok ? "text-emerald-400" : "text-destructive"}`}>
                  {check.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                  {check.ok ? "working" : "failed"} · {timeAgo(check.at)}
                </span>
              )}
            </div>
            <Field label={settings?.hasKey ? "Replace key" : "VOXTTS_API_KEY"}>
              <Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="vox_sk_…" className="font-mono" data-testid="key-input" />
            </Field>
            <Field label="API base URL">
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="font-mono" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={!!busy || (!key && baseUrl === settings?.baseUrl)} data-testid="save-key">
                {busy === "save" && <Loader2 className="animate-spin" />} Save
              </Button>
              <Button variant="outline" onClick={runTest} disabled={!!busy || !settings?.hasKey}>
                {busy === "test" && <Loader2 className="animate-spin" />} Test connection
              </Button>
              {settings?.keySource === "saved" && (
                <Button variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive" onClick={remove} disabled={!!busy}>
                  Remove key
                </Button>
              )}
            </div>
            {check && !check.ok && <p className="text-xs text-destructive">{check.error}</p>}
          </Card>

          <Card className="space-y-2 text-[12px] leading-relaxed text-muted-foreground">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <ShieldCheck className="h-4 w-4 text-emerald-400" /> How the key is handled
            </div>
            <p>It is stored only in this computer's local database. The browser never receives it. The local server adds it to requests to {settings?.baseUrl ?? "voxtts.app"}, and it is never sent anywhere else.</p>
            <p>The server listens on 127.0.0.1 only, so other devices on your network cannot use it. "Test connection" calls GET /api/v1/models, which costs nothing.</p>
            <p>If the key is ever exposed, revoke it on voxtts.app and paste a new one here.</p>
          </Card>
        </div>

        <div className="space-y-4">
          {test && (
            <Card>
              <div className="mb-2 text-sm font-medium">Models this key can use · {test.ms} ms</div>
              <div className="space-y-1.5">
                {test.details.map((m) => (
                  <div key={m.id} className="flex items-start gap-2 text-[12px]">
                    <span className="w-28 shrink-0 font-mono text-foreground">{m.id}</span>
                    <span className="text-muted-foreground">
                      {m.description} {m.latency && <span className="text-foreground/70">({m.latency})</span>}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          <Card>
            <div className="mb-2 flex items-center text-sm font-medium">
              Spent through this app this month
              <span className="ml-auto font-mono text-gold">{month.toLocaleString()} chars</span>
            </div>
            {usage && usage.byModel.length > 0 ? (
              <table className="w-full text-[12px]">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="py-1 text-left font-medium">Model</th>
                    <th className="text-right font-medium">This month</th>
                    <th className="text-right font-medium">All time</th>
                    <th className="text-right font-medium">Requests</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.byModel.map((r) => (
                    <tr key={r.model} className="border-t">
                      <td className="py-1">{MODELS[r.model]?.label ?? r.model}</td>
                      <td className="text-right font-mono">{(r.month || 0).toLocaleString()}</td>
                      <td className="text-right font-mono">{r.total.toLocaleString()}</td>
                      <td className="text-right font-mono">{r.requests}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-muted-foreground">Nothing spent yet.</p>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">
              Counted locally. Your real balance and quota are on voxtts.app; Flash and Vox 3 Express count half on Pro and Scale.
            </p>
          </Card>
          {usage && (
            <Card className="flex items-center gap-3 text-[12px]">
              <div className="flex-1">
                <div className="font-medium">Render cache</div>
                <div className="text-muted-foreground">
                  {usage.cache.files} files · {formatBytes(usage.cache.bytes)} · <span className="text-emerald-400">{usage.cache.saved.toLocaleString()} characters saved</span> by replaying cached audio
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  if (!confirm("Delete every cached render? Re-rendering spends characters again. Library items are not affected.")) return;
                  await api.clearCache().catch(fail);
                  loadUsage();
                }}
              >
                Clear
              </Button>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
