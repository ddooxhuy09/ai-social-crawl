import React, { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import TaskCard from "./TaskCard";
import { STATUS_CFG, STATUS_LABEL, STATUS_ORDER, makeTask } from "./constants";

export default function KanbanColumn({ 
  phase, 
  onUpdate, 
  onDelete, 
  onNavigate, 
  onRunTask, 
  onTaskClick,
  isRunning, 
  projectName, 
  phaseName, 
  queue 
}) {
  const [newTask, setNewTask] = useState("");

  const addTask = () => {
    const t = newTask.trim();
    if (!t) return;
    onUpdate({ ...phase, tasks: [...(phase.tasks || []), makeTask(t)] });
    setNewTask("");
  };

  const toggleTask = (taskId) =>
    onUpdate({ ...phase, tasks: phase.tasks.map(t => t.id === taskId ? { ...t, status: t.status === "done" ? "todo" : "done" } : t) });

  const doneTasks = (phase.tasks || []).filter(t => t.status === "done").length;
  const totalTasks = (phase.tasks || []).length;
  const derivedStatus = totalTasks === 0 ? "pending" : (doneTasks === totalTasks ? "done" : (doneTasks > 0 ? "in_progress" : "pending"));
  const cfg = STATUS_CFG[derivedStatus] || STATUS_CFG.pending;

  return (
    <div className={`flex flex-col rounded-2xl border w-[280px] shrink-0 shadow-sm transition-all overflow-hidden ${cfg.hdr} hover:shadow-md bg-gray-50/40`}>
      {/* Column Header */}
      <div className={`px-4 pt-4 pb-3 border-b border-gray-200/60 bg-white/60 backdrop-blur-sm`}>
        <div className="flex items-center gap-2.5 mb-3">
          <span className="text-xl">{phase.icon}</span>
          <h3 className="text-[0.9rem] font-bold text-gray-800 flex-1 leading-tight truncate">{phase.name}</h3>
          <Button variant="ghost" type="button" onClick={onDelete} className="text-gray-300 hover:text-red-500 text-xl shrink-0 w-6 h-6 p-0 hover:bg-red-50 flex items-center justify-center transition-colors">×</Button>
        </div>
        
        <div className="flex items-center justify-between gap-2">
          <div
            className={`text-[0.65rem] px-2.5 py-1 rounded-full border shadow-sm font-bold transition-colors flex items-center gap-1.5 ${cfg.badge}`}
          >
            {derivedStatus === "in_progress" && <span className="inline-block w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />}
            {STATUS_LABEL[derivedStatus]}
          </div>
          
          {totalTasks > 0 && (
            <span className="text-xs font-medium text-gray-400 bg-gray-100/80 px-2 py-0.5 rounded-full">
              {doneTasks}/{totalTasks}
            </span>
          )}
        </div>

        {/* Progress Bar */}
        {totalTasks > 0 && (
          <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden shadow-inner w-full">
            <div
              className={`h-full rounded-full transition-all duration-500 ${derivedStatus === 'done' ? 'bg-emerald-400' : 'bg-sky-400'}`}
              style={{ width: `${(doneTasks / totalTasks) * 100}%` }}
            />
          </div>
        )}
      </div>

      {/* Task List */}
      <div className="flex flex-col gap-3 p-3 overflow-y-auto flex-1 custom-scrollbar" style={{ maxHeight: "calc(100vh - 280px)" }}>
        {(phase.tasks || []).map(task => (
          <TaskCard
            key={task.id}
            task={task}
            onToggle={toggleTask}
            onClick={() => onTaskClick(task, phase.id)}
            onNavigate={onNavigate}
            onRunTask={(t) => onRunTask && onRunTask(t, projectName, phaseName)}
            isRunning={isRunning}
            queue={queue}
          />
        ))}
        {phase.tasks?.length === 0 && (
          <div className="mt-4 flex flex-col items-center justify-center text-gray-300 gap-2">
            <span className="text-2xl opacity-50">📂</span>
            <p className="text-xs font-medium">Chưa có công việc nào</p>
          </div>
        )}
      </div>

      {/* Add Task Input */}
      <div className="flex items-center gap-2 p-3 bg-white/80 border-t border-gray-100 backdrop-blur">
        <Input
          value={newTask}
          onChange={e => setNewTask(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addTask()}
          placeholder="Thêm việc cần làm..."
          className="text-sm h-9 py-1"
        />
        <Button 
          type="button" 
          size="sm" 
          className="w-9 h-9 p-0 bg-blue-600 hover:bg-blue-700 text-white shadow font-bold text-lg" 
          onClick={addTask}
        >
          +
        </Button>
      </div>
    </div>
  );
}
