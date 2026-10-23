import type React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import { Loading } from './components/ui';
import Login from './pages/Login';
import Intro from './pages/Intro';
import Overview from './pages/Overview';
import Dashboard from './pages/Dashboard';
import Units from './pages/Units';
import Fees from './pages/Fees';
import Ledger from './pages/Ledger';
import Packages from './pages/Packages';
import Facilities from './pages/Facilities';
import Repairs from './pages/Repairs';
import Announcements from './pages/Announcements';
import Meetings, { MeetingDetail } from './pages/Meetings';
import Vendors from './pages/Vendors';
import { Accounts, CommunitySettings, MySettings } from './pages/Admin';
import { ResidentLayout, ResidentLogin, RBills, RBooking, RHome, RMe, RNews, RRepairs } from './pages/resident/Portal';

function Private({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/intro" element={<Intro />} />
          <Route path="/r/login" element={<ResidentLogin />} />
          <Route path="/r" element={<ResidentLayout />}>
            <Route index element={<RHome />} />
            <Route path="bills" element={<RBills />} />
            <Route path="booking" element={<RBooking />} />
            <Route path="repairs" element={<RRepairs />} />
            <Route path="news" element={<RNews />} />
            <Route path="me" element={<RMe />} />
          </Route>
          <Route path="/" element={<Private><Layout /></Private>}>
            <Route index element={<Dashboard />} />
            <Route path="overview" element={<Overview />} />
            <Route path="units" element={<Units />} />
            <Route path="fees" element={<Fees />} />
            <Route path="ledger" element={<Ledger />} />
            <Route path="packages" element={<Packages />} />
            <Route path="facilities" element={<Facilities />} />
            <Route path="repairs" element={<Repairs />} />
            <Route path="announcements" element={<Announcements />} />
            <Route path="meetings" element={<Meetings />} />
            <Route path="meetings/:id" element={<MeetingDetail />} />
            <Route path="vendors" element={<Vendors />} />
            <Route path="community" element={<CommunitySettings />} />
            <Route path="accounts" element={<Accounts />} />
            <Route path="settings" element={<MySettings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
