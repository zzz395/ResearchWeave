import { createBrowserRouter } from "react-router-dom";

import { FoundationPage } from "../features/foundation/pages/foundation-page";
import { NotFoundPage } from "./not-found-page";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <FoundationPage />,
  },
  {
    path: "*",
    element: <NotFoundPage />,
  },
]);
