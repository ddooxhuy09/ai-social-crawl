import React, { useEffect, useState, useCallback, useRef, useTransition } from "react";
import { API_BASE } from "./constants";
import CrawlPage from "./pages/CrawlPage";
import HuntPage from "./pages/HuntPage";
import PinterestImagePage from "./pages/PinterestImagePage";
import ProjectsPage from "./pages/projects";
import MainImagePage from "./pages/MainImagePage";
import ChatCreateImagePage from "./pages/ChatCreateImagePage";
import RequirementsPage from "./pages/product-requirements";
import EtsyListingPage from "./pages/EtsyListingPage";
import AppSidebar from "./components/AppSidebar";
import QueueModal from "./pages/projects/modals/QueueModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import LoginPage from "./pages/LoginPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import ProfilePage from "./pages/ProfilePage";

// ── Global fetch patch: attach Bearer token to all /api/ requests ──────────────
const _origFetch = window.fetch.bind(window);
window.fetch = function (input, init = {}) {
  const token = localStorage.getItem("auth_token");
  if (token) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input.url || "");
    if (url.includes("/api/") && !url.includes("/api/auth/")) {
      init = { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } };
    }
  }
  return _origFetch(input, init).then((response) => {
    if (response.status === 401 && localStorage.getItem("auth_token")) {
      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_user");
      window.location.reload();
    }
    return response;
  });
};

// ── Auth wrapper ───────────────────────────────────────────────────────────────
export default function App() {
  const [authToken, setAuthToken] = useState(() => localStorage.getItem("auth_token"));
  const [authUser, setAuthUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("auth_user") || "null"); } catch { return null; }
  });
  const [authPage, setAuthPage] = useState("login"); // "login" | "forgot"

  // Detect Supabase recovery token in URL hash (#access_token=...&type=recovery)
  const recoveryTokens = (() => {
    const hash = window.location.hash.slice(1);
    const params = Object.fromEntries(new URLSearchParams(hash));
    if (params.type === "recovery" && params.access_token) return params;
    return null;
  })();

  const handleLogin = (token, user) => {
    localStorage.setItem("auth_token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
    setAuthToken(token);
    setAuthUser(user);
  };

  const handleLogout = async () => {
    await fetch(`${API_BASE}/api/auth/logout`, { method: "POST" }).catch(() => {});
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    setAuthToken(null);
    setAuthUser(null);
  };

  const handleResetSuccess = () => {
    window.history.replaceState(null, "", window.location.pathname);
    window.location.reload();
  };

  if (recoveryTokens) {
    return (
      <ResetPasswordPage
        accessToken={recoveryTokens.access_token}
        refreshToken={recoveryTokens.refresh_token}
        onSuccess={handleResetSuccess}
      />
    );
  }

  if (!authToken) {
    if (authPage === "forgot") return <ForgotPasswordPage onBack={() => setAuthPage("login")} />;
    return <LoginPage onLogin={handleLogin} onForgotPassword={() => setAuthPage("forgot")} />;
  }

  return <MainApp authUser={authUser} setAuthUser={setAuthUser} onLogout={handleLogout} />;
}

// ── Main app (only mounts when authenticated) ──────────────────────────────────
function MainApp({ authUser, setAuthUser, onLogout }) {
  const [profileOpen, setProfileOpen] = useState(false);

  const handleUpdateUser = (updated) => {
    setAuthUser(updated);
    localStorage.setItem("auth_user", JSON.stringify(updated));
  };
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Projects state
  const [projects, setProjects] = useState([]);
  const [projLoading, setProjLoading] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [loadingProjectId, setLoadingProjectId] = useState(null);
  const selectedProjectIdRef = useRef(null);
  const projectCacheRef = useRef(new Map()); // id → full project data
  const prevQueueRef = useRef([]);

  const [isPending, startTransition] = useTransition();

  const handleSelectProject = useCallback((id) => {
    // Immediate sidebar highlight — must be outside startTransition
    setSelectedProjectId(id);
    // Deferred heavy content swap — keep isPending spinner while React renders
    startTransition(() => {
      if (!id) {
        setSelectedProject(null);
      } else if (projectCacheRef.current.has(id)) {
        setSelectedProject(projectCacheRef.current.get(id));
      }
    });
  }, []);

  // Queue state (synced from server)
  const [queue, setQueue] = useState([]);
  const [isWorkerRunning, setIsWorkerRunning] = useState(false);
  const [queueModalOpen, setQueueModalOpen] = useState(false);

  // Keep ref in sync for use inside callbacks without stale closure
  useEffect(() => { selectedProjectIdRef.current = selectedProjectId; }, [selectedProjectId]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/history`);
      if (!res.ok) throw new Error(`Lỗi tải lịch sử: ${res.status}`);
      setHistory(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Load full detail of one project — serves from cache if available
  const loadSelectedProject = useCallback(async (id) => {
    if (!id) return;
    // Serve cached version instantly, then refresh in background
    if (projectCacheRef.current.has(id)) {
      setSelectedProject(projectCacheRef.current.get(id));
    } else {
      // No cache → clear stale data immediately so old project never shows for new id
      setSelectedProject(null);
      setLoadingProjectId(id);
    }
    try {
      const res = await fetch(`${API_BASE}/api/projects/${id}`);
      if (res.ok) {
        const data = await res.json();
        projectCacheRef.current.set(id, data);
        // Only update if this id is still the one being requested
        if (selectedProjectIdRef.current === id) {
          setSelectedProject(data);
        }
      }
    } catch (e) { console.error(e); }
    finally { setLoadingProjectId(null); }
  }, []);

  // When selected project changes, do NOT null out — swap when ready to avoid blank flash
  useEffect(() => {
    if (selectedProjectId) {
      loadSelectedProject(selectedProjectId);
    } else {
      setSelectedProject(null);
    }
  }, [selectedProjectId, loadSelectedProject]);

  // Fetch only metadata list — no selectedProjectId dependency
  const fetchProjects = useCallback(async () => {
    setProjLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/projects`);
      const data = await res.json();
      setProjects(data);
      setSelectedProjectId(prev => prev || (data.length > 0 ? data[0].id : null));
    } catch (e) {
      console.error("fetchProjects failed:", e);
    } finally {
      setProjLoading(false);
    }
  }, []);

  // Fetch only queue state — called every 5s
  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/projects/queue`);
      if (!res.ok) return;
      const data = await res.json();
      const newTasks = data.tasks || [];

      // If a running task just finished, reload the selected project
      const wasRunning = prevQueueRef.current.filter(t => t.status === "running");
      if (wasRunning.length > 0) {
        const stillRunning = newTasks.filter(t => t.status === "running");
        if (stillRunning.length < wasRunning.length && selectedProjectIdRef.current) {
          projectCacheRef.current.delete(selectedProjectIdRef.current); // bust cache — task result changed
          loadSelectedProject(selectedProjectIdRef.current);
        }
      }

      prevQueueRef.current = newTasks;
      setQueue(newTasks);
      setIsWorkerRunning(data.running || false);
    } catch (e) {
      console.error("fetchQueue failed:", e);
    }
  }, [loadSelectedProject]);

  // Initial load — parallel
  useEffect(() => {
    Promise.all([fetchProjects(), fetchQueue(), loadHistory()]);
  }, [fetchProjects, fetchQueue, loadHistory]);

  // Poll only queue every 5s (lightweight)
  useEffect(() => {
    const id = setInterval(fetchQueue, 5000);
    return () => clearInterval(id);
  }, [fetchQueue]);

  const saveProject = useCallback(async (updated) => {
    try {
      await fetch(`${API_BASE}/api/projects/${updated.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      projectCacheRef.current.set(updated.id, updated); // keep cache fresh
      setSelectedProject(updated);
      // Update only status fields in the metadata list
      setProjects(prev => prev.map(p => p.id !== updated.id ? p : {
        ...p,
        original: { status: updated.original?.status || "empty" },
        redesign: { status: updated.redesign?.status || "empty" },
        final:    { status: updated.final?.status    || "empty" },
      }));
    } catch (e) { console.error(e); }
  }, []);

  const addToQueue = async (task, projId, projName, phaseName) => {
    if (queue.some(q => q.taskId === task.id && (q.status === "pending" || q.status === "running"))) {
      alert("Task này đã có trong hàng đợi!");
      return;
    }

    const queueItem = {
      id: "task_" + Date.now(),
      title: task.title,
      keyword: task.linked_keyword,
      page: task.linked_page,
      imageData: task.linked_image_data || null,
      imageName: task.linked_image_name || null,
      projectId: projId,
      projectName: projName,
      phaseName: phaseName,
      taskId: task.id,
      status: "pending",
    };

    try {
      const res = await fetch(`${API_BASE}/api/projects/queue/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(queueItem),
      });
      if (!res.ok) throw new Error("Thêm vào hàng đợi thất bại");
      fetchQueue(); // Only refresh queue, not all projects
    } catch (e) {
      alert(e.message);
    }
  };

  const retryQueueItem = async (id) => {
    console.log("Retry requested for", id);
  };

  const updateQueueLocal = async (newTasks) => {
    const payload = Array.isArray(newTasks)
      ? { running: isWorkerRunning, tasks: newTasks }
      : newTasks;
    setQueue(payload.tasks);
    await fetch(`${API_BASE}/api/projects/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  };

  const toggleWorker = async (running) => {
    setIsWorkerRunning(running);
    await fetch(`${API_BASE}/api/projects/queue/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ running }),
    });
  };

  const initialTab = window.location.pathname.startsWith("/hunt") ? "hunt" :
    window.location.pathname.startsWith("/etsy-listing") ? "etsy-listing" :
    window.location.pathname.startsWith("/pinterest-image") ? "pinterest-image" :
    window.location.pathname.startsWith("/projects") ? "projects" :
    window.location.pathname.startsWith("/main-image") ? "main-image" :
    window.location.pathname.startsWith("/chat-create-image") ? "chat-create-image" :
    window.location.pathname.startsWith("/requirements") ? "requirements" : "crawl";
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    const onPopState = () => {
      setActiveTab(
        window.location.pathname.startsWith("/hunt") ? "hunt" :
        window.location.pathname.startsWith("/etsy-listing") ? "etsy-listing" :
        window.location.pathname.startsWith("/pinterest-image") ? "pinterest-image" :
        window.location.pathname.startsWith("/projects") ? "projects" :
        window.location.pathname.startsWith("/main-image") ? "main-image" :
        window.location.pathname.startsWith("/chat-create-image") ? "chat-create-image" :
        window.location.pathname.startsWith("/requirements") ? "requirements" : "crawl"
      );
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const switchTab = (tab) => {
    setActiveTab(tab);
    const pathMap = {
      hunt: "/hunt",
      "etsy-listing": "/etsy-listing",
      "pinterest-image": "/pinterest-image",
      projects: "/projects",
      "main-image": "/main-image",
      "chat-create-image": "/chat-create-image",
      requirements: "/requirements"
    };
    const newPath = pathMap[tab] || "/";
    if (window.location.pathname !== newPath) window.history.pushState({}, "", newPath);
  };

  const [initHistoryId, setInitHistoryId] = useState(null);
  const [initImageHistoryId, setInitImageHistoryId] = useState(null);
  const [initListingName, setInitListingName] = useState(null);
  const [initPickContext, setInitPickContext] = useState(null);

  const handleNavigate = (tab, kw, hId = null, pickContext = null) => {
    if (tab === "crawl") {
      if (kw) setKeyword(kw);
      setInitHistoryId(hId);
      setInitPickContext(pickContext || null);
    }
    if (tab === "pinterest-image") { setInitImageHistoryId(hId); }
    if (tab === "etsy-listing")    { setInitListingName(kw || null); }
    switchTab(tab);
  };

  const handlePickOriginal = async (pin, projectId) => {
    try {
      await fetch(`${API_BASE}/api/projects/${projectId}/original/set-original`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item: pin }),
      });
      setInitPickContext(null);
      setSelectedProjectId(projectId);
      await loadSelectedProject(projectId);
      switchTab("projects");
    } catch (e) { console.error(e); }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-100 font-sans">
      <AppSidebar activeTab={activeTab} onSelect={switchTab} />
      <main className="flex flex-col flex-1 overflow-hidden bg-white">
        <header className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">Pinterest Crawler</h1>
            <p className="text-[13px] text-gray-500 mt-0.5">Quản lý task tự động và lịch sử crawl đa nền tảng.</p>
          </div>
          <div className="flex gap-2 items-center">
            {(() => {
              const isRunning = queue.some(t => t.status === "running");
              return (
                <button
                  type="button"
                  onClick={() => setQueueModalOpen(true)}
                  className={`px-4 py-1.5 rounded-full border text-sm font-semibold transition-all flex items-center gap-2.5 ${
                    isRunning
                      ? "bg-emerald-500 text-white border-emerald-400 shadow-lg shadow-emerald-100 animate-pulse"
                      : "bg-white text-gray-700 border-gray-200 hover:border-gray-300 hover:bg-gray-50 shadow-sm"
                  }`}
                >
                  <span className="text-lg">{isRunning ? "⏳" : "📋"}</span>
                  <span>{isRunning ? "Running..." : "Tasks"}</span>
                  {queue.length > 0 && (
                    <span className={`min-w-[20px] h-5 flex items-center justify-center rounded-full text-[11px] px-1.5 ${
                      isRunning ? "bg-white text-emerald-600" : "bg-gray-100 text-gray-600"
                    }`}>
                      {queue.length}
                    </span>
                  )}
                </button>
              );
            })()}
            <div className="flex items-center gap-2 ml-1 pl-3 border-l border-gray-100">
              <button
                type="button"
                onClick={() => setProfileOpen(true)}
                title="Hồ sơ"
                className="flex items-center gap-2 hover:opacity-80 transition-opacity"
              >
                {authUser?.avatar_url ? (
                  <img
                    src={`${API_BASE}${authUser.avatar_url}`}
                    alt="avatar"
                    className="w-7 h-7 rounded-full object-cover border border-gray-200"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-semibold text-gray-600 border border-gray-200">
                    {(authUser?.email || "?")[0].toUpperCase()}
                  </div>
                )}
                <span className="text-[12px] text-gray-500 hidden sm:block">{authUser?.email}</span>
              </button>
              <button
                type="button"
                onClick={onLogout}
                title="Đăng xuất"
                className="px-3 py-1.5 rounded-full border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors"
              >
                Đăng xuất
              </button>
            </div>
          </div>
        </header>

        <QueueModal
          open={queueModalOpen}
          onClose={() => setQueueModalOpen(false)}
          queue={queue}
          isWorkerRunning={isWorkerRunning}
          onToggleRunning={toggleWorker}
          isQueueRunning={queue.some(t => t.status === "running")}
          currentQueueTask={queue.find(t => t.status === "running")}
          onClear={async () => {
            setQueue([]);
            setIsWorkerRunning(false);
            await fetch(`${API_BASE}/api/projects/queue`, { method: "DELETE" });
          }}
          onUpdate={updateQueueLocal}
          onRetry={retryQueueItem}
        />

        {historyLoading && (
          <div className="mx-6 mt-3 text-xs font-medium text-sky-700 bg-sky-50 border border-sky-100 rounded-lg px-3 py-2 flex items-center gap-2 shrink-0">
            <span className="animate-spin text-sky-500">⏳</span> Đang đồng bộ lịch sử hệ thống...
          </div>
        )}
        {error && <div className="mx-6 mt-3 text-[13px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 shrink-0">{error}</div>}

        <div className="flex-1 overflow-auto">
          {activeTab === "crawl" ? (
            <CrawlPage keyword={keyword} setKeyword={setKeyword} loading={loading} setLoading={setLoading} error={error} setError={setError} result={result} setResult={setResult} history={history} loadHistory={loadHistory} historyLoading={historyLoading} initialHistoryId={initHistoryId} onInitConsumed={() => setInitHistoryId(null)} pickContext={initPickContext} onPickOriginal={handlePickOriginal} />
          ) : activeTab === "pinterest-image" ? (
            <PinterestImagePage history={history} loadHistory={loadHistory} initialHistoryId={initImageHistoryId} onInitConsumed={() => setInitImageHistoryId(null)} />
          ) : activeTab === "hunt" ? (
            <HuntPage setResult={setResult} loadHistory={loadHistory} />
          ) : activeTab === "projects" ? (
            <ErrorBoundary>
              <ProjectsPage isPending={isPending} onNavigate={handleNavigate} projects={projects} setProjects={setProjects} loading={projLoading} selectedId={selectedProjectId} setSelectedId={handleSelectProject} selectedProject={selectedProject} saveProject={saveProject} queue={queue} setQueue={setQueue} onAddTaskToQueue={addToQueue} loadingProjectId={loadingProjectId} />
            </ErrorBoundary>
          ) : activeTab === "main-image" ? (
            <MainImagePage />
          ) : activeTab === "chat-create-image" ? (
            <ChatCreateImagePage />
          ) : activeTab === "requirements" ? (
            <RequirementsPage />
          ) : activeTab === "etsy-listing" ? (
            <EtsyListingPage initialListingName={initListingName} onInitConsumed={() => setInitListingName(null)} />
          ) : null}
        </div>
      </main>

      {profileOpen && (
        <ProfilePage
          authUser={authUser}
          onClose={() => setProfileOpen(false)}
          onUpdateUser={handleUpdateUser}
        />
      )}
    </div>
  );
}
