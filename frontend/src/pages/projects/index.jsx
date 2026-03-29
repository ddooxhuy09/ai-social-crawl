import React, { useEffect, useState } from "react";
import { API_BASE } from "../../constants";
import ProjectSidebar from "./ProjectSidebar";
import OriginalPhase from "./phases/OriginalPhase";
import RedesignPhase from "./phases/RedesignPhase";
import FinalPhase from "./phases/FinalPhase";

const PHASES = [
  { key: "original",  label: "Original",       icon: "🎯" },
  { key: "redesign",  label: "Redesign",        icon: "✏️" },
  { key: "final",     label: "Final Design",    icon: "📄" },
];

export default function ProjectsPage({
  onNavigate,
  projects, setProjects,
  loading,
  selectedId, setSelectedId,
  selectedProject,
  saveProject,
  queue,
  onAddTaskToQueue,
}) {
  const [activePhase, setActivePhase] = useState("original");
  const [createModal, setCreateModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPhases, setNewPhases] = useState(["original", "redesign", "final"]);

  const selected = selectedProject;

  // Set active phase to the first available phase when switching project
  useEffect(() => { 
    if (selected) {
      const allowed = selected.phases || ["original", "redesign", "final"];
      if (allowed.length > 0 && !allowed.includes(activePhase)) {
        setActivePhase(allowed[0]);
      } else if (allowed.length > 0) {
        setActivePhase(activePhase || allowed[0]);
      }
    } else {
      setActivePhase("original");
    }
  }, [selectedId, selected?.phases]);

  const handleCreateProject = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const res = await fetch(`${API_BASE}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: newDesc.trim(), phases: newPhases }),
      });
      const p = await res.json();
      setProjects(prev => [p, ...prev]);
      setSelectedId(p.id);
      setCreateModal(false);
      setNewName(""); setNewDesc("");
      setNewPhases(["original", "redesign", "final"]);
    } catch (e) { console.error(e); }
  };

  const handleDeleteProject = async (id) => {
    if (!window.confirm("Xóa project này?")) return;
    try {
      await fetch(`${API_BASE}/api/projects/${id}`, { method: "DELETE" });
      setProjects(prev => prev.filter(p => p.id !== id));
      if (selectedId === id) setSelectedId(projects.find(p => p.id !== id)?.id || null);
    } catch (e) { console.error(e); }
  };

  // Phase status helper
  const phaseStatus = (key) => selected?.[key]?.status || "empty";

  const phaseDot = (key) => {
    const s = phaseStatus(key);
    if (s === "done") return "bg-emerald-400";
    if (s === "empty") return "bg-gray-300";
    return "bg-sky-400 animate-pulse";
  };

  return (
    <div className="flex h-full overflow-hidden">
      <ProjectSidebar
        projects={projects}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onDelete={handleDeleteProject}
        onCreate={() => setCreateModal(true)}
        loading={loading}
      />

      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Phase tabs */}
        {selected && (
          <div className="flex items-center gap-1 px-4 pt-3 pb-0 border-b border-gray-100 shrink-0">
            {PHASES.filter(ph => (selected.phases || ["original", "redesign", "final"]).includes(ph.key)).map((ph, i, arr) => (
              <React.Fragment key={ph.key}>
                <button
                  type="button"
                  onClick={() => setActivePhase(ph.key)}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-all ${
                    activePhase === ph.key
                      ? "border-sky-500 text-sky-700 bg-sky-50"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${phaseDot(ph.key)}`} />
                  <span>{ph.icon} {ph.label}</span>
                </button>
                {i < arr.length - 1 && (
                  <span className="text-gray-300 text-lg">›</span>
                )}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Phase content */}
        <div className="flex-1 overflow-auto">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 gap-3">
              <span className="text-5xl">📁</span>
              <p className="text-sm font-medium">Chọn hoặc tạo project để bắt đầu</p>
              <button
                type="button"
                onClick={() => setCreateModal(true)}
                className="px-4 py-2 rounded-lg bg-sky-500 text-white text-sm font-semibold hover:bg-sky-600 transition-colors"
              >
                + Tạo project mới
              </button>
            </div>
          ) : activePhase === "original" ? (
            <OriginalPhase
              project={selected}
              saveProject={saveProject}
              onAddTaskToQueue={onAddTaskToQueue}
              onNavigate={onNavigate}
            />
          ) : activePhase === "redesign" ? (
            <RedesignPhase
              project={selected}
              saveProject={saveProject}
              onAddTaskToQueue={onAddTaskToQueue}
              queue={queue}
              onNavigate={onNavigate}
            />
          ) : (
            <FinalPhase
              project={selected}
              saveProject={saveProject}
            />
          )}
        </div>
      </div>

      {/* Create project modal */}
      {createModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
          onClick={e => { if (e.target === e.currentTarget) setCreateModal(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-[420px] p-6 flex flex-col gap-4">
            <h2 className="text-lg font-bold text-gray-900">Tạo project mới</h2>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700">Tên project</label>
              <input
                autoFocus
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                placeholder="VD: Crochet Blanket Collection"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleCreateProject()}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700">Mô tả (tuỳ chọn)</label>
              <textarea
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 resize-none"
                rows={2}
                placeholder="Mô tả ngắn..."
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
              />
            </div>
            
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700">Phases</label>
              <div className="flex flex-col gap-1.5">
                {PHASES.map(ph => (
                  <label key={ph.key} className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="accent-sky-500 w-4 h-4"
                      checked={newPhases.includes(ph.key)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setNewPhases(prev => [...prev, ph.key]);
                        } else {
                          setNewPhases(prev => prev.filter(k => k !== ph.key));
                        }
                      }}
                    />
                    <span className="text-sm text-gray-700">{ph.icon} {ph.label}</span>
                  </label>
                ))}
              </div>
            </div>
            
            <div className="flex gap-2 justify-end mt-2">
              <button type="button" onClick={() => setCreateModal(false)}
                className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Huỷ</button>
              <button type="button" onClick={handleCreateProject} disabled={!newName.trim()}
                className="px-4 py-2 rounded-lg bg-sky-500 text-white text-sm font-semibold hover:bg-sky-600 disabled:opacity-50">Tạo</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
