import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { basePath, ErrorBoundary, VenueAnnouncement } from "@bargames/gamekit/client";
import { AdminPage } from "./pages/AdminPage";
import { HomePage } from "./pages/HomePage";
import { RoomPage } from "./pages/RoomPage";
import { useVenue } from "./useVenue";
import "./index.css";

/**
 * Bar Games: keeps the venue theme applied everywhere, and shows the staff's
 * announcement on every page. It follows the staff's choice of phones or TVs, top or
 * bottom, and hides itself where it doesn't belong (the room page marks TV screens);
 * it publishes its height as --bargames-announcement-top/-bottom, which the layout
 * leaves room for. Off a box it renders nothing.
 */
function Venue() {
  return <VenueAnnouncement ctx={useVenue()} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {/* basePath(): "/buzzboard" under a path prefix, "" at the root. */}
      <BrowserRouter basename={basePath()}>
        <Venue />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/join/:code" element={<HomePage />} />
          <Route path="/room/:code" element={<RoomPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
