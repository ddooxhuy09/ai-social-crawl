import React, { useState } from "react";
import { Button } from "../../components/ui/button";
import KanbanColumn from "./KanbanColumn";
import TaskDetailModal from "./modals/TaskDetailModal";

export default function KanbanBoard({
  selected,
  onAddPhase,
  onUpdatePhase,
  onDeletePhase,
  onRunTask,
  isQueueRunning,
  currentQueueTask,
  queue,
  onOpenQueue,
  onNavigate
}) {
  const [selectedTaskContext, setSelectedTaskContext] = useState(null); // { task, phaseId }

  if (!selected) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-4 bg-gray-50/50 flex-1">
        <div className="text-6xl drop-shadow-sm opacity-80">📁</div>
        <p className="text-lg font-medium text-gray-500">Chọn hoặc tạo một project để bắt đầu</p>
      </div>
    );
  }

  const handleUpdateTask = (phaseId, taskId, updates) => {
    const phase = selected.phases.find(p => p.id === phaseId);
    if (!phase) return;
    const updatedPhase = {
      ...phase,
      tasks: phase.tasks.map(t => t.id === taskId ? { ...t, ...updates } : t)
    };
    onUpdatePhase(phaseId, updatedPhase);
    
    if (selectedTaskContext && selectedTaskContext.task.id === taskId) {
      setSelectedTaskContext({ phaseId, task: { ...selectedTaskContext.task, ...updates } });
    }
  };

  const handleDeleteTask = (phaseId, taskId) => {
    const phase = selected.phases.find(p => p.id === phaseId);
    if (!phase) return;
    const updatedPhase = {
      ...phase,
      tasks: phase.tasks.filter(t => t.id !== taskId)
    };
    onUpdatePhase(phaseId, updatedPhase);
  };

  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-gray-50/30">
      <div className="flex items-center gap-4 md:gap-6 px-4 md:px-8 py-4 md:py-6 border-b border-gray-100 bg-white shrink-0 shadow-sm z-10 overflow-x-auto">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-extrabold text-gray-900 truncate tracking-tight">{selected.name}</h2>
            {selected.description && (
              <span className="text-sm font-medium px-3 py-1 bg-gray-100/80 rounded-full text-gray-500 truncate hidden md:inline max-w-md">
                {selected.description}
              </span>
            )}
          </div>
          {selected.phases.length > 0 && (
            <div className="flex items-start mt-6 overflow-x-auto pb-2 custom-scrollbar">
              {selected.phases.map((ph, i) => {
                const totalPhasks = (ph.tasks || []).length;
                const donePhasks = (ph.tasks || []).filter(t => t.status === "done").length;
                const derivedStatus = totalPhasks === 0 ? "pending" : (donePhasks === totalPhasks ? "done" : (donePhasks > 0 ? "in_progress" : "pending"));
                
                const isDone = derivedStatus === "done";
                const isActive = derivedStatus === "in_progress";
                return (
                  <div key={ph.id} className="flex items-start shrink-0 group">
                    <div className="flex flex-col items-center gap-2.5 min-w-[80px] max-w-[100px]">
                      <div className={`w-11 h-11 rounded-full flex items-center justify-center text-lg transition-all duration-300 shadow-sm ${
                        isDone    ? "bg-emerald-500 border-2 border-emerald-500 text-white shadow-emerald-200" :
                        isActive  ? "bg-sky-500 border-2 border-sky-500 text-white ring-4 ring-sky-100 shadow-sky-200 scale-110" :
                                    "bg-white border-2 border-gray-200 text-gray-400 group-hover:border-gray-300"
                      }`}>
                        {isDone ? "✓" : ph.icon}
                      </div>
                      <span className={`text-xs leading-tight text-center block ${
                        isDone ? "text-emerald-600 font-bold" : isActive ? "text-sky-600 font-extrabold" : "text-gray-400 font-medium group-hover:text-gray-500"
                      }`}>{ph.name}</span>
                    </div>
                    {i < selected.phases.length - 1 && (
                      <div className="flex flex-col justify-center h-11 px-2 shrink-0">
                        <div className={`h-1 w-12 rounded-full transition-colors ${isDone ? "bg-emerald-400" : "bg-gray-200"}`} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex gap-3 shrink-0">
          <Button variant="outline" className="border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 shadow-sm transition-all" onClick={onAddPhase}>
            + Thêm Giai đoạn (Phase)
          </Button>
        </div>
      </div>

      {selected.phases.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-gray-400 gap-4">
          <div className="text-6xl drop-shadow-sm opacity-60">🗂️</div>
          <p className="text-base font-medium">Chưa có giai đoạn nào. Nhấn &quot;+ Thêm Giai đoạn&quot; để bắt đầu dự án.</p>
        </div>
      ) : (
        <div className="flex gap-5 p-6 overflow-x-auto flex-1 items-start bg-gray-50/50 custom-scrollbar">
          {selected.phases.map(phase => (
            <KanbanColumn
              key={phase.id}
              phase={phase}
              onUpdate={updated => onUpdatePhase(phase.id, updated)}
              onDelete={() => onDeletePhase(phase.id)}
              onRunTask={onRunTask}
              onTaskClick={(task, phaseId) => setSelectedTaskContext({ task, phaseId })}
              isRunning={isQueueRunning && currentQueueTask?.projectId === selected.id}
              projectName={selected.name}
              phaseName={phase.name}
              queue={queue}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}

      {/* Task Modal */}
      <TaskDetailModal
        open={!!selectedTaskContext}
        onClose={() => setSelectedTaskContext(null)}
        task={selectedTaskContext?.task}
        onSaveNote={(taskId, notes) => handleUpdateTask(selectedTaskContext.phaseId, taskId, { notes })}
        onSaveDates={(taskId, start_date, deadline) => handleUpdateTask(selectedTaskContext.phaseId, taskId, { start_date, deadline })}
        onSaveLink={(taskId, linked_page, linked_keyword, linked_image_data, linked_image_name) =>
          handleUpdateTask(selectedTaskContext.phaseId, taskId, { linked_page, linked_keyword, linked_image_data, linked_image_name })
        }
        onRemoveLink={(taskId) => handleUpdateTask(selectedTaskContext.phaseId, taskId, { linked_page: null, linked_keyword: "", linked_image_data: "", linked_image_name: "" })}
        onDelete={(taskId) => handleDeleteTask(selectedTaskContext.phaseId, taskId)}
      />
    </div>
  );
}
