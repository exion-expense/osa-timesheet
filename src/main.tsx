import '@fontsource/ibm-plex-sans-thai/400.css'
import '@fontsource/ibm-plex-sans-thai/500.css'
import '@fontsource/ibm-plex-sans-thai/600.css'
import './index.css'

import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { RequireStaff } from './components/Guards'
import { Layout } from './components/Layout'
import { Spinner, ToastProvider } from './components/ui'
import { AuthProvider } from './lib/auth'

const Login = lazy(() => import('./pages/Login'))
const Mfa = lazy(() => import('./pages/Mfa'))
const Kiosk = lazy(() => import('./pages/Kiosk'))
const Privacy = lazy(() => import('./pages/Privacy'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Today = lazy(() => import('./pages/Today'))
const Inbox = lazy(() => import('./pages/Inbox'))
const Jobs = lazy(() => import('./pages/Jobs'))
const JobForm = lazy(() => import('./pages/JobForm'))
const JobDetail = lazy(() => import('./pages/JobDetail'))
const TeamPage = lazy(() => import('./pages/TeamPage'))
const DaySheet = lazy(() => import('./pages/DaySheet'))
const CostSheet = lazy(() => import('./pages/CostSheet'))
const Costs = lazy(() => import('./pages/Costs'))
const Users = lazy(() => import('./pages/admin/Users'))
const Settings = lazy(() => import('./pages/admin/Settings'))
const Audit = lazy(() => import('./pages/admin/Audit'))
const PrintDay = lazy(() => import('./print/PrintDay'))
const PrintTimesheet = lazy(() => import('./print/PrintTimesheet'))
const PrintSummary = lazy(() => import('./print/PrintSummary'))
const PrintQr = lazy(() => import('./print/PrintQr'))
const NotFound = lazy(() => import('./pages/NotFound'))

const router = createBrowserRouter([
  { path: '/c/:token', element: <Kiosk /> },
  { path: '/privacy', element: <Privacy /> },
  { path: '/login', element: <Login /> },
  { path: '/mfa', element: <Mfa /> },
  {
    element: <RequireStaff />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <Dashboard /> },
          { path: 'today', element: <Today /> },
          { path: 'inbox', element: <Inbox /> },
          { path: 'jobs', element: <Jobs /> },
          { path: 'jobs/new', element: <JobForm /> },
          { path: 'jobs/:id', element: <JobDetail /> },
          { path: 'jobs/:id/edit', element: <JobForm /> },
          { path: 'teams/:id', element: <TeamPage /> },
          { path: 'days/:id', element: <DaySheet /> },
          { path: 'costs', element: <Costs /> },
          { path: 'cost/:id', element: <CostSheet /> },
          { path: 'admin/users', element: <Users /> },
          { path: 'admin/settings', element: <Settings /> },
          { path: 'admin/audit', element: <Audit /> },
        ],
      },
      { path: 'print/day/:id', element: <PrintDay /> },
      { path: 'print/timesheet/:id', element: <PrintTimesheet /> },
      { path: 'print/summary/:id', element: <PrintSummary /> },
      { path: 'print/qr/:id', element: <PrintQr /> },
    ],
  },
  { path: '*', element: <NotFound /> },
], { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' })

if (window.top !== window.self) {
  document.body.textContent = 'ไม่อนุญาตให้เปิดในกรอบของเว็บอื่น'
  throw new Error('framed')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <Suspense fallback={<Spinner />}>
          <RouterProvider router={router} />
        </Suspense>
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
)
