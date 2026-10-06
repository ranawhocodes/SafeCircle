/**
 * The app shell. Five faces plus the device simulator, each on its own route:
 *
 *   /volunteer        Face B, the responder PWA
 *   /volunteer-app    Face B mobile: standalone mobile volunteer app (no topbar)
 *   /family/:token    Face A, the family status page (no sign-in)
 *   /dashboard        the guard desk and authority dashboard
 *   /portal           Face A, the caregiver setup portal
 *   /bystander/:code  what a stranger sees after scanning a pendant QR
 *   /sim              the device simulator, standing in for the hardware
 */
import { NavLink, Navigate, Route, BrowserRouter as Router, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Bystander } from './faces/Bystander.tsx';
import { Dashboard } from './faces/Dashboard.tsx';
import { Family } from './faces/Family.tsx';
import { Portal } from './faces/Portal.tsx';
import { Simulator } from './faces/Simulator.tsx';
import { Volunteer } from './faces/Volunteer.tsx';
import { VolunteerApp } from './faces/VolunteerApp.tsx';
import { Home } from './faces/Home.tsx';

function AppInner(): ReactNode {
  const location = useLocation();
  const isStandalone = location.pathname.startsWith('/volunteer-app');

  return (
    <div className="app">
      {!isStandalone && (
        <header className="topbar">
          <NavLink to="/" className="brand" style={{ color: '#fff', textDecoration: 'none' }}>
            SafeCircle <small>first five minutes</small>
          </NavLink>
          <nav aria-label="Faces">
            <NavLink to="/sim">Button</NavLink>
            <NavLink to="/volunteer">Volunteer</NavLink>
            <NavLink to="/volunteer-app">App</NavLink>
            <NavLink to="/dashboard">Dashboard</NavLink>
            <NavLink to="/portal">Portal</NavLink>
          </nav>
        </header>
      )}

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/sim" element={<Simulator />} />
        <Route path="/volunteer" element={<Volunteer />} />
        <Route path="/volunteer-app" element={<VolunteerApp />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/portal" element={<Portal />} />
        <Route path="/family/:token" element={<Family />} />
        <Route path="/bystander/:code" element={<Bystander />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export function App(): ReactNode {
  return (
    <Router>
      <AppInner />
    </Router>
  );
}
