import React, { useEffect, useState, useCallback, useRef, useTransition } from "react";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { API_BASE } from "./constants";
import CrawlPage from "./pages/CrawlPage";
import HuntPage from "./pages/HuntPage";
import PinterestImagePage from "./pages/PinterestImagePage";
import ProjectsPage from "./pages/projects";
import ChatCreateImagePage from "./pages/ChatCreateImagePage";
import ProductInsightsPage from "./pages/ProductInsightsPage";

import UserFavoriteItemsPage from "./pages/UserFavoriteItemsPage";
import RequirementsPage from "./pages/product-requirements";
import EtsyListingPage from "./pages/EtsyListingPage";
import AppSidebar from "./components/AppSidebar";
import QueueModal from "./pages/projects/modals/QueueModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import LoginPage from "./pages/LoginPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import ProfilePage from "./pages/ProfilePage";
import { TaskQueueProvider, useTaskQueue } from "./context/TaskQueueContext";
import CookiePopover from "./components/CookiePopover";

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

  return (
    <BrowserRouter>
      {recoveryTokens ? (
        <ResetPasswordPage
          accessToken={recoveryTokens.access_token}
          refreshToken={recoveryTokens.refresh_token}
          onSuccess={handleResetSuccess}
        />
      ) : !authToken ? (
        authPage === "forgot"
          ? <ForgotPasswordPage onBack={() => setAuthPage("login")} />
          : <LoginPage onLogin={handleLogin} onForgotPassword={() => setAuthPage("forgot")} />
      ) : (
        <MainApp authUser={authUser} setAuthUser={setAuthUser} onLogout={handleLogout} />
      )}
    </BrowserRouter>
  );
}

// ── Main app (only mounts when authenticated) ──────────────────────────────────
// Owns all project/crawl/navigation state and wraps children in TaskQueueProvider.
// Queue state lives entirely in TaskQueueProvider — MainApp never reads it directly.
function MainApp({ authUser, setAuthUser, onLogout }) {
  const navigate = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);

  const handleUpdateUser = (updated) => {
    setAuthUser(updated);
    localStorage.setItem("auth_user", JSON.stringify(updated));
  };

  // ── Crawl state ──────────────────────────────────────────────────────────────
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── Projects state ───────────────────────────────────────────────────────────
  const [projects, setProjects] = useState([]);
  const [projLoading, setProjLoading] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [loadingProjectId, setLoadingProjectId] = useState(null);
  const selectedProjectIdRef = useRef(null);
  const projectCacheRef = useRef(new Map()); // id → full project data

  const [isPending, startTransition] = useTransition();

  const handleSelectProject = useCallback((id) => {
    setSelectedProjectId(id);
    startTransition(() => {
      if (!id) {
        setSelectedProject(null);
      } else if (projectCacheRef.current.has(id)) {
        setSelectedProject(projectCacheRef.current.get(id));
      }
    });
  }, []);

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
    if (projectCacheRef.current.has(id)) {
      setSelectedProject(projectCacheRef.current.get(id));
    } else {
      setSelectedProject(null);
      setLoadingProjectId(id);
    }
    try {
      const res = await fetch(`${API_BASE}/api/projects/${id}`);
      if (res.ok) {
        const data = await res.json();
        projectCacheRef.current.set(id, data);
        if (selectedProjectIdRef.current === id) {
          setSelectedProject(data);
        }
      }
    } catch (e) { console.error(e); }
    finally { setLoadingProjectId(null); }
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      loadSelectedProject(selectedProjectId);
    } else {
      setSelectedProject(null);
    }
  }, [selectedProjectId, loadSelectedProject]);

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

  const saveProject = useCallback(async (updated) => {
    try {
      await fetch(`${API_BASE}/api/projects/${updated.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      projectCacheRef.current.set(updated.id, updated);
      setSelectedProject(updated);
      setProjects(prev => prev.map(p => p.id !== updated.id ? p : {
        ...p,
        original: { status: updated.original?.status || "empty" },
        redesign: { status: updated.redesign?.status || "empty" },
        final:    { status: updated.final?.status    || "empty" },
      }));
    } catch (e) { console.error(e); }
  }, []);

  // Initial load (queue is fetched independently by TaskQueueProvider)
  useEffect(() => {
    Promise.all([fetchProjects(), loadHistory()]);
  }, [fetchProjects, loadHistory]);

  // ── Callback fired by TaskQueueProvider when a running task finishes ─────────
  const handleTaskComplete = useCallback(() => {
    if (selectedProjectIdRef.current) {
      projectCacheRef.current.delete(selectedProjectIdRef.current); // bust cache
      loadSelectedProject(selectedProjectIdRef.current);
    }
  }, [loadSelectedProject]);

  // ── Transient navigation state (one-time props for destination pages) ────────
  const [initHistoryId, setInitHistoryId] = useState(null);
  const [initImageHistoryId, setInitImageHistoryId] = useState(null);
  const [initListingName, setInitListingName] = useState(null);
  const [initPickContext, setInitPickContext] = useState(null);

  const handleNavigate = (tab, kw, hId = null, pickContext = null) => {
    const pathMap = {
      hunt: "/hunt",
      "etsy-listing": "/etsy-listing",
      "pinterest-image": "/pinterest-image",
      projects: "/projects",
      "chat-create-image": "/chat-create-image",
      "product-insights": "/product-insights",

      "user-favorite-items": "/user-favorite-items",
      requirements: "/requirements",
    };
    if (tab === "crawl") {
      if (kw) setKeyword(kw);
      setInitHistoryId(hId);
      setInitPickContext(pickContext || null);
    }
    if (tab === "pinterest-image") { setInitImageHistoryId(hId); }
    if (tab === "etsy-listing")    { setInitListingName(kw || null); }
    navigate(pathMap[tab] || "/");
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
      navigate("/projects");
    } catch (e) { console.error(e); }
  };

  return (
    <TaskQueueProvider onTaskComplete={handleTaskComplete}>
      <div className="flex h-screen w-screen overflow-hidden bg-gray-100 font-sans">
        <AppSidebar />
        <main className="flex flex-col flex-1 overflow-hidden bg-white">

          {/* AppHeader consumes TaskQueueContext for queue badge + QueueModal */}
          <AppHeader
            authUser={authUser}
            onLogout={onLogout}
            onOpenProfile={() => setProfileOpen(true)}
          />

          {historyLoading && (
            <div className="mx-6 mt-3 text-xs font-medium text-sky-700 bg-sky-50 border border-sky-100 rounded-lg px-3 py-2 flex items-center gap-2 shrink-0">
              <span className="animate-spin text-sky-500">⏳</span> Đang đồng bộ lịch sử hệ thống...
            </div>
          )}
          {error && <div className="mx-6 mt-3 text-[13px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 shrink-0">{error}</div>}

          <div className="flex-1 overflow-auto">
            <Routes>
              <Route path="/" element={
                <CrawlPage keyword={keyword} setKeyword={setKeyword} loading={loading} setLoading={setLoading} error={error} setError={setError} result={result} setResult={setResult} history={history} loadHistory={loadHistory} historyLoading={historyLoading} initialHistoryId={initHistoryId} onInitConsumed={() => setInitHistoryId(null)} pickContext={initPickContext} onPickOriginal={handlePickOriginal} />
              } />
              <Route path="/hunt" element={
                <HuntPage setResult={setResult} loadHistory={loadHistory} />
              } />
              <Route path="/pinterest-image" element={
                <PinterestImagePage history={history} loadHistory={loadHistory} initialHistoryId={initImageHistoryId} onInitConsumed={() => setInitImageHistoryId(null)} />
              } />
              <Route path="/projects" element={
                // ProjectsRoute consumes TaskQueueContext for queue/addToQueue
                <ProjectsRoute
                  isPending={isPending}
                  onNavigate={handleNavigate}
                  projects={projects}
                  setProjects={setProjects}
                  loading={projLoading}
                  selectedId={selectedProjectId}
                  setSelectedId={handleSelectProject}
                  selectedProject={selectedProject}
                  saveProject={saveProject}
                  loadingProjectId={loadingProjectId}
                />
              } />
              <Route path="/chat-create-image" element={<ChatCreateImagePage />} />
              <Route path="/requirements" element={<RequirementsPage />} />
              <Route path="/product-insights" element={<ProductInsightsPage />} />

              <Route path="/user-favorite-items" element={<UserFavoriteItemsPage />} />
              <Route path="/etsy-listing" element={
                <EtsyListingPage initialListingName={initListingName} onInitConsumed={() => setInitListingName(null)} />
              } />
            </Routes>
          </div>
        </main>
      </div>

      {profileOpen && (
        <ProfilePage
          authUser={authUser}
          onClose={() => setProfileOpen(false)}
          onUpdateUser={handleUpdateUser}
        />
      )}
    </TaskQueueProvider>
  );
}

// ── AppHeader — consumes TaskQueueContext ──────────────────────────────────────
// Renders the top header bar (title, queue badge button, user avatar/logout) and
// the QueueModal. Isolated here so MainApp never has to touch queue state.
function AppHeader({ authUser, onLogout, onOpenProfile }) {
  const {
    queue,
    isWorkerRunning,
    queueModalOpen,
    setQueueModalOpen,
    toggleWorker,
    updateQueueLocal,
    retryQueueItem,
    clearQueue,
  } = useTaskQueue();

  const isRunning = queue.some(t => t.status === "running");

  return (
    <>
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
        <div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">Pinterest Crawler</h1>
          <p className="text-[13px] text-gray-500 mt-0.5">Quản lý task tự động và lịch sử crawl đa nền tảng.</p>
        </div>
        <div className="flex gap-2 items-center">
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

          <div className="flex items-center gap-2 ml-1 pl-3 border-l border-gray-100">
            <button
              type="button"
              onClick={onOpenProfile}
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

            <CookiePopover />
          </div>
        </div>
      </header>

      <QueueModal
        open={queueModalOpen}
        onClose={() => setQueueModalOpen(false)}
        queue={queue}
        isWorkerRunning={isWorkerRunning}
        onToggleRunning={toggleWorker}
        isQueueRunning={isRunning}
        currentQueueTask={queue.find(t => t.status === "running")}
        onClear={clearQueue}
        onUpdate={updateQueueLocal}
        onRetry={retryQueueItem}
      />
    </>
  );
}

// ── ProjectsRoute — consumes TaskQueueContext ──────────────────────────────────
// Bridges the /projects route with queue state from context so ProjectsPage never
// has to know where that state comes from.
function ProjectsRoute({ isPending, onNavigate, projects, setProjects, loading, selectedId, setSelectedId, selectedProject, saveProject, loadingProjectId }) {
  const { queue, addToQueue } = useTaskQueue();
  return (
    <ErrorBoundary>
      <ProjectsPage
        isPending={isPending}
        onNavigate={onNavigate}
        projects={projects}
        setProjects={setProjects}
        loading={loading}
        selectedId={selectedId}
        setSelectedId={setSelectedId}
        selectedProject={selectedProject}
        saveProject={saveProject}
        queue={queue}
        onAddTaskToQueue={addToQueue}
        loadingProjectId={loadingProjectId}
      />
    </ErrorBoundary>
  );
}
