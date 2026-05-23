import React, { useEffect, useState, useCallback } from "react";
import { Languages, Plus, Trash2, RefreshCw, FileText } from "lucide-react";
import { API_BASE } from "../../constants";
import TerminologyEditor from "./TerminologyEditor";
import ProjectEditor from "./ProjectEditor";

const TABS = [
  { key: "projects",    label: "Projects" },
  { key: "terminology", label: "Terminology" },
];

export default function TranslateChartPage() {
  const [tab, setTab]         = useState("projects");
  const [projects, setProjects] = useState([]);
  const [loading, setLoading]  = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedFull, setSelectedFull] = useState(null);
  const [newName, setNewName]  = useState("");
  const [creating, setCreating] = useState(false);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/translate-chart/projects`);
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
        if (!selectedId && data.length > 0) setSelectedId(data[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/api/translate-chart/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const proj = await res.json();
        setProjects((prev) => [proj, ...prev]);
        setSelectedId(proj.id);
        setNewName("");
        setTab("projects");
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!confirm("Delete this project?")) return;
    await fetch(`${API_BASE}/api/translate-chart/projects/${id}`, { method: "DELETE" });
    setProjects((prev) => prev.filter((p) => p.id !== id));
    if (selectedId === id) setSelectedId(projects.find((p) => p.id !== id)?.id ?? null);
  };

  // Fetch full project detail (includes input_md) whenever selection changes
  useEffect(() => {
    if (!selectedId) { setSelectedFull(null); return; }
    setSelectedFull(null);
    fetch(`${API_BASE}/api/translate-chart/projects/${selectedId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setSelectedFull(data); })
      .catch(() => {});
  }, [selectedId]);

  const handleProjectUpdated = useCallback((updated) => {
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
    setSelectedFull((prev) => prev ? { ...prev, ...updated } : prev);
  }, []);

  return (
    <div className="flex flex-col md:flex-row h-full overflow-hidden">
      {/* ── Left sidebar ── */}
      <aside className="w-full md:w-[240px] shrink-0 flex flex-col border-r border-gray-100 bg-gray-50 overflow-hidden md:max-w-[240px] max-h-[200px] md:max-h-none border-b md:border-b-0">
        {/* Tab switcher */}
        <div className="flex border-b border-gray-100">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-3 text-xs font-semibold transition-colors ${
                tab === t.key
                  ? "text-sky-700 border-b-2 border-sky-600 bg-white"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "projects" && (
          <>
            {/* New project */}
            <div className="p-3 border-b border-gray-100 flex gap-2">
              <input
                className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-sky-400"
                placeholder="Project name…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-sky-600 text-white rounded-lg text-xs font-medium hover:bg-sky-700 disabled:opacity-40 shrink-0"
              >
                {creating ? <RefreshCw size={11} className="animate-spin" /> : <Plus size={11} />}
              </button>
            </div>

            {/* Project list */}
            <div className="flex-1 overflow-auto">
              {loading ? (
                <div className="p-4 text-xs text-gray-400 text-center">Loading…</div>
              ) : projects.length === 0 ? (
                <div className="p-4 text-xs text-gray-400 text-center">No projects yet.</div>
              ) : (
                projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full text-left px-3 py-2.5 flex items-start justify-between gap-2 border-b border-gray-100 hover:bg-gray-100 transition-colors ${
                      selectedId === p.id ? "bg-white border-l-2 border-l-sky-500" : ""
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-gray-800 truncate">{p.name}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <OcrBadge status={p.ocr_status} />
                        {(p.available_langs ?? []).length > 0 && (
                          <span className="text-[10px] text-indigo-600 font-medium">
                            {p.available_langs.length} lang{p.available_langs.length > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleDelete(p.id, e)}
                      className="text-gray-300 hover:text-red-400 transition-colors mt-0.5 shrink-0"
                    >
                      <Trash2 size={12} />
                    </button>
                  </button>
                ))
              )}
            </div>
          </>
        )}

        {tab === "terminology" && (
          <div className="flex-1 overflow-auto p-3 text-xs text-gray-500 text-center pt-6">
            Edit terminology in the panel on the right.
          </div>
        )}
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === "terminology" ? (
          <TerminologyEditor />
        ) : selectedFull ? (
          <ProjectEditor key={selectedFull.id} project={selectedFull} onProjectUpdated={handleProjectUpdated} />
        ) : selectedId ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">
            <RefreshCw size={14} className="animate-spin mr-2" /> Loading…
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-gray-400">
            <Languages size={32} className="text-gray-200" />
            <p className="text-sm">Select or create a project to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function OcrBadge({ status }) {
  if (!status || status === "idle") return null;
  const map = {
    processing: { cls: "bg-amber-50 text-amber-600", label: "OCR…" },
    ready:      { cls: "bg-green-50 text-green-600",  label: "Ready" },
    error:      { cls: "bg-red-50 text-red-500",      label: "Error" },
  };
  const { cls, label } = map[status] ?? {};
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${cls}`}>
      {status === "processing" && <RefreshCw size={8} className="inline animate-spin mr-0.5" />}
      {label}
    </span>
  );
}
