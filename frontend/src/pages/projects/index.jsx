import React, { useEffect, useState } from "react";
import { API_BASE } from "../../constants";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
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
  isPending,
  onNavigate,
  projects, setProjects,
  loading,
  selectedId, setSelectedId,
  selectedProject,
  saveProject,
  queue,
  onAddTaskToQueue,
  loadingProjectId,
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
        loadingProjectId={loadingProjectId}
      />

      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Progress Stepper Pipeline */}
        {selected && (
          <div className="flex items-center px-8 py-5 border-b border-gray-100 bg-white shrink-0 shadow-sm relative z-10">
            {PHASES.filter(ph => (selected.phases || ["original", "redesign", "final"]).includes(ph.key)).map((ph, i, arr) => {
              const status = phaseStatus(ph.key);
              const isActive = activePhase === ph.key;
              const isDone = status === "done";
              const isWorking = status !== "done" && status !== "empty";

              return (
                <React.Fragment key={ph.key}>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => setActivePhase(ph.key)}
                    className={`group relative flex items-center gap-3 bg-white transition-all px-0 h-auto hover:bg-transparent`}
                  >
                    {/* Circle Focus */}
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all ${
                      isActive ? "border-violet-600 bg-violet-600 shadow-lg shadow-violet-200 ring-4 ring-violet-50 scale-110" :
                      isDone ? "border-emerald-500 bg-emerald-500 shadow-md shadow-emerald-100" :
                      isWorking ? "border-amber-400 bg-amber-50" :
                      "border-gray-200 bg-gray-50 group-hover:border-gray-300 group-hover:bg-white"
                    }`}>
                      {isActive ? <span className="text-white text-sm font-bold">{i + 1}</span> :
                       isDone ? <span className="text-white text-sm font-bold">✓</span> :
                       isWorking ? <span className="text-amber-500 text-sm font-bold animate-spin-slow">↻</span> :
                       <span className="text-gray-400 text-sm font-bold group-hover:text-gray-600">{i + 1}</span>}
                    </div>
                    {/* Label/Status */}
                    <div className="flex flex-col items-start text-left mt-0.5">
                      <span className={`text-[10px] uppercase font-bold tracking-wider leading-none mb-1 ${
                        isActive ? "text-violet-600" : 
                        isDone ? "text-emerald-600" :
                        isWorking ? "text-amber-500" :
                        "text-gray-400 group-hover:text-gray-500"
                      }`}>
                        Step {i + 1}
                      </span>
                      <span className={`text-[13px] font-bold leading-none ${
                        isActive ? "text-gray-900" :
                        isDone || isWorking ? "text-gray-800" :
                        "text-gray-500 group-hover:text-gray-700"
                      }`}>
                        {ph.label}
                      </span>
                    </div>
                  </Button>

                  {/* Connecting Line */}
                  {i < arr.length - 1 && (
                    <div className="flex-1 mx-6 h-[3px] bg-gray-100 rounded-full relative min-w-[40px]">
                      {isDone && (
                        <div className="absolute inset-y-0 left-0 bg-emerald-400 w-full rounded-full transition-all duration-500" />
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}

        {/* Phase content */}
        <div className="flex-1 overflow-auto bg-gray-50/30 relative">
          <div className={`absolute inset-0 transition-opacity duration-300 ${isPending ? 'opacity-100 z-50 bg-white/60 backdrop-blur-[2px]' : 'opacity-0 pointer-events-none -z-10'}`}>
            <div className="flex h-full items-center justify-center">
               <div className="bg-white px-5 py-3 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-gray-100 flex items-center gap-3 transform -translate-y-10">
                 <div className="w-5 h-5 rounded-full border-2 border-violet-200 border-t-violet-600 animate-spin" />
                 <span className="text-sm font-bold text-gray-700">Loading workspace...</span>
               </div>
            </div>
          </div>

          <div className={`h-full transition-opacity duration-300 ${isPending ? 'opacity-30 pointer-events-none' : 'opacity-100'}`}>
            {loadingProjectId === selectedId ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 rounded-full border-2 border-violet-200 border-t-violet-600 animate-spin" />
                <p className="text-sm font-semibold text-gray-500">Đang tải project...</p>
              </div>
              <div className="w-64 flex flex-col gap-2 mt-2">
                <div className="h-3 bg-gray-100 rounded-full animate-pulse w-full" />
                <div className="h-3 bg-gray-100 rounded-full animate-pulse w-4/5" />
                <div className="h-3 bg-gray-100 rounded-full animate-pulse w-3/5" />
              </div>
            </div>
          ) : !selected ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 gap-3">
              <span className="text-5xl">📁</span>
              <p className="text-sm font-medium">Chọn hoặc tạo project để bắt đầu</p>
              <Button
                variant="sky"
                type="button"
                onClick={() => setCreateModal(true)}
              >
                + Tạo project mới
              </Button>
            </div>
          ) : activePhase === "original" ? (
            <OriginalPhase
              key={selected.id}
              project={selected}
              saveProject={saveProject}
              onAddTaskToQueue={onAddTaskToQueue}
              onNavigate={onNavigate}
            />
          ) : activePhase === "redesign" ? (
            <RedesignPhase
              key={selected.id}
              project={selected}
              saveProject={saveProject}
              onAddTaskToQueue={onAddTaskToQueue}
              queue={queue}
              onNavigate={onNavigate}
            />
          ) : (
            <FinalPhase
              key={selected.id}
              project={selected}
              saveProject={saveProject}
            />
          )}
          </div>
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
              <Input
                autoFocus
                className="text-sm"
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
              <Button variant="outline" type="button" onClick={() => setCreateModal(false)}>Huỷ</Button>
              <Button variant="sky" type="button" onClick={handleCreateProject} disabled={!newName.trim()}>Tạo</Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
