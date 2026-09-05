import { createBrowserRouter } from "react-router-dom";

import { PageLoading } from "../components/ui/feedback";
import { AnonymousBoundary, AuthResolution, ProtectedBoundary } from "./auth-boundaries";
import { AppShell } from "./app-shell";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AuthResolution />,
  },
  {
    element: <AnonymousBoundary />,
    hydrateFallbackElement: <PageLoading label="Loading account access" />,
    children: [
      { path: "/login", lazy: () => import("../features/auth/pages/login-page") },
      { path: "/register", lazy: () => import("../features/auth/pages/register-page") },
    ],
  },
  {
    element: <ProtectedBoundary />,
    hydrateFallbackElement: <PageLoading label="Loading workspace" />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: "/research", lazy: () => import("../features/research/pages/research-page") },
          {
            path: "/research/papers/:paperId",
            lazy: () => import("../features/research/pages/research-paper-page"),
          },
          { path: "/agents", lazy: () => import("../features/agents/pages/agents-page") },
          {
            path: "/agents/tasks",
            lazy: () => import("../features/agents/pages/agent-tasks-page"),
          },
          {
            path: "/agents/tasks/:taskId",
            lazy: () => import("../features/agents/pages/agent-task-page"),
          },
          {
            path: "/agents/runs/:runId",
            lazy: () => import("../features/agents/pages/agent-run-page"),
          },
          { path: "/spaces", lazy: () => import("../features/spaces/pages/spaces-page") },
          { path: "/spaces/new", lazy: () => import("../features/spaces/pages/new-space-page") },
          {
            path: "/spaces/:spaceId",
            lazy: () => import("../features/spaces/components/space-layout"),
            children: [
              { index: true, lazy: () => import("../features/spaces/pages/space-detail-page") },
              { path: "chat", lazy: () => import("../features/chat/pages/space-chat-page") },
              {
                path: "saved-papers",
                lazy: () => import("../features/research/pages/saved-papers-page"),
              },
              { path: "knowledge", lazy: () => import("../features/knowledge/pages/knowledge-page") },
              { path: "members", lazy: () => import("../features/members/pages/space-members-page") },
              { path: "settings", lazy: () => import("../features/spaces/pages/space-settings-page") },
            ],
          },
          { path: "/connections", lazy: () => import("../features/connections/pages/connections-page") },
        ],
      },
    ],
  },
  {
    path: "*",
    lazy: () => import("./not-found-page"),
  },
]);
