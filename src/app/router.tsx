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
          { path: "/spaces", lazy: () => import("../features/spaces/pages/spaces-page") },
          { path: "/spaces/new", lazy: () => import("../features/spaces/pages/new-space-page") },
          { path: "/spaces/:spaceId", lazy: () => import("../features/spaces/pages/space-detail-page") },
          {
            path: "/spaces/:spaceId/settings",
            lazy: () => import("../features/spaces/pages/space-settings-page"),
          },
        ],
      },
    ],
  },
  {
    path: "*",
    lazy: () => import("./not-found-page"),
  },
]);
