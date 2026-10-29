import { lazy, Suspense } from 'react';
import type React from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import { Loading } from './components/ui';
import Login from './pages/Login';

// 依頁面分包：住戶手機端與介紹頁不必下載管理端的程式
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })));
const Intro = page(() => import('./pages/Intro'), 'default');
const Overview = page(() => import('./pages/Overview'), 'default');
const Dashboard = page(() => import('./pages/Dashboard'), 'default');
const Units = page(() => import('./pages/Units'), 'default');
const Fees = page(() => import('./pages/Fees'), 'default');
const Ledger = page(() => import('./pages/Ledger'), 'default');
const Packages = page(() => import('./pages/Packages'), 'default');
const Facilities = page(() => import('./pages/Facilities'), 'default');
const Repairs = page(() => import('./pages/Repairs'), 'default');
const Announcements = page(() => import('./pages/Announcements'), 'default');
const Meetings = page(() => import('./pages/Meetings'), 'default');
const MeetingDetail = page(() => import('./pages/Meetings'), 'MeetingDetail');
const Vendors = page(() => import('./pages/Vendors'), 'default');
const Visitors = page(() => import('./pages/Visitors'), 'default');
const Patrol = page(() => import('./pages/Patrol'), 'default');
const PatrolScan = page(() => import('./pages/Patrol'), 'PatrolScan');
const Feedback = page(() => import('./pages/Feedback'), 'default');
const Documents = page(() => import('./pages/Documents'), 'default');
const Assets = page(() => import('./pages/Assets'), 'default');
const Privacy = page(() => import('./pages/Privacy'), 'default');
const Accounts = page(() => import('./pages/Admin'), 'Accounts');
const CommunitySettings = page(() => import('./pages/Admin'), 'CommunitySettings');
const MySettings = page(() => import('./pages/Admin'), 'MySettings');
const ResidentLayout = page(() => import('./pages/resident/Portal'), 'ResidentLayout');
const ResidentLogin = page(() => import('./pages/resident/Portal'), 'ResidentLogin');
const RBills = page(() => import('./pages/resident/Portal'), 'RBills');
const RBooking = page(() => import('./pages/resident/Portal'), 'RBooking');
const RHome = page(() => import('./pages/resident/Portal'), 'RHome');
const RMe = page(() => import('./pages/resident/Portal'), 'RMe');
const RNews = page(() => import('./pages/resident/Portal'), 'RNews');
const RRepairs = page(() => import('./pages/resident/Portal'), 'RRepairs');

function Private({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  const loc = useLocation();
  // 未登入時記下原本要去的頁面（例如掃巡邏 QR Code），登入後導回
  return user ? <>{children}</> : <Navigate to="/login" replace state={{ from: loc.pathname }} />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/intro" element={<Intro />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/patrol/scan/:code" element={<Private><PatrolScan /></Private>} />
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
            <Route path="visitors" element={<Visitors />} />
            <Route path="patrol" element={<Patrol />} />
            <Route path="feedback" element={<Feedback />} />
            <Route path="documents" element={<Documents />} />
            <Route path="assets" element={<Assets />} />
            <Route path="community" element={<CommunitySettings />} />
            <Route path="accounts" element={<Accounts />} />
            <Route path="settings" element={<MySettings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
