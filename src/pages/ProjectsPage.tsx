import { useState } from "react";
import { Archive, ArchiveRestore, Check, Folder, FolderPlus, Loader2, Pencil, Trash2 } from "lucide-react";
import { fail, useApp } from "@/app/store";
import { Card, Empty, Field, PageHeader } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { Project } from "@/lib/types";

const COLORS = ["#8b5cf6", "#34d399", "#f472b6", "#60a5fa", "#fbbf24", "#f87171", "#2dd4bf"];

export function ProjectsPage() {
  const projects = useApp((s) => s.projects);
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle="Folders for your work. Pick one in the sidebar and new speech, podcasts, audiobooks, transcripts and timelines are filed into it."
        actions={
          <Button size="sm" onClick={() => setEditing("new")}>
            <FolderPlus /> New project
          </Button>
        }
      />
      <div className="grid gap-3 p-6 md:grid-cols-2 xl:grid-cols-3">
        {projects.length === 0 && (
          <div className="col-span-full">
            <Empty icon={<Folder />} title="No projects yet">
              Projects keep a client's or a series' audio together. Moving things between projects never re-renders or bills anything.
            </Empty>
          </div>
        )}
        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} onEdit={() => setEditing(p)} onDelete={() => setDeleting(p)} />
        ))}
      </div>
      {editing && <ProjectForm project={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteProject project={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

function ProjectCard({ project: p, onEdit, onDelete }: { project: Project; onEdit: () => void; onDelete: () => void }) {
  const active = useApp((s) => s.activeProjectId === p.id);
  const { setActiveProject, navigate, refreshProjects } = useApp.getState();
  return (
    <Card className={`space-y-3 ${p.archived ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2">
        <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: p.color }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium">{p.name}</span>
            {active && <Badge variant="success">active</Badge>}
            {p.archived && <Badge variant="secondary">archived</Badge>}
          </div>
          {p.description && <p className="text-[11px] text-muted-foreground">{p.description}</p>}
        </div>
      </div>
      <div className="flex gap-3 text-[11px] text-muted-foreground">
        <span>{p.counts.library} in Library</span>
        <span>{p.counts.audiobooks} audiobooks</span>
        <span>{p.counts.timelines} timelines</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" onClick={() => navigate("library", { project: String(p.id) })}>
          Open
        </Button>
        {!p.archived && (
          <Button size="sm" variant={active ? "secondary" : "outline"} onClick={() => setActiveProject(active ? null : p.id)}>
            <Check /> {active ? "Working in it" : "Work in it"}
          </Button>
        )}
        <Button size="icon" variant="ghost" title="Edit" onClick={onEdit}>
          <Pencil />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title={p.archived ? "Restore" : "Archive"}
          onClick={async () => {
            await api.patchProject(p.id, { archived: !p.archived }).catch(fail);
            refreshProjects();
          }}
        >
          {p.archived ? <ArchiveRestore /> : <Archive />}
        </Button>
        <Button size="icon" variant="ghost" className="hover:text-destructive" title="Delete" onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>
    </Card>
  );
}

function ProjectForm({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [color, setColor] = useState(project?.color ?? COLORS[0]);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      if (project) await api.patchProject(project.id, { name, description, color });
      else {
        const { project: p } = await api.createProject({ name, description, color });
        useApp.getState().setActiveProject(p.id);
      }
      await useApp.getState().refreshProjects();
      onClose();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{project ? "Edit project" : "New project"}</DialogTitle>
        </DialogHeader>
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && save()} />
        </Field>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        </Field>
        <div className="flex gap-2">
          {COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)} className={`h-6 w-6 rounded-full ring-offset-2 ring-offset-panel ${color === c ? "ring-2 ring-white" : ""}`} style={{ background: c }} />
          ))}
        </div>
        <Button onClick={save} disabled={busy || !name.trim()}>
          {busy && <Loader2 className="animate-spin" />} {project ? "Save" : "Create and work in it"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function DeleteProject({ project, onClose }: { project: Project; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const run = async (contents: "unfile" | "delete") => {
    setBusy(true);
    try {
      await api.deleteProject(project.id, contents);
      await useApp.getState().refreshProjects();
      onClose();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete "{project.name}"?</DialogTitle>
          <DialogDescription>
            It holds {project.counts.library} Library items, {project.counts.audiobooks} audiobooks and {project.counts.timelines} timelines.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Button variant="outline" disabled={busy} onClick={() => run("unfile")}>
            Delete the project, keep its contents (default)
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => run("delete")}>
            Delete the project and its Library items and timelines
          </Button>
          <p className="text-[11px] text-muted-foreground">Audiobooks live on voxtts.app and are only unfiled either way.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
