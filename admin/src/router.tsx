import { createBrowserRouter, RouterProvider } from 'react-router'
import AdminShell from './components/AdminShell'
import Audit from './screens/Audit'
import Collections from './screens/Collections'
import Dashboard from './screens/Dashboard'
import DocumentEditor from './screens/DocumentEditor'
import EntryEditor from './screens/EntryEditor'
import Forms from './screens/Forms'
import Login from './screens/Login'
import Media from './screens/Media'
import NotFound from './screens/NotFound'
import Pages from './screens/Pages'
import Settings from './screens/Settings'
import SubmissionDetail from './screens/SubmissionDetail'
import Submissions from './screens/Submissions'
import Users from './screens/Users'

/*
 * Admin routes (spec §5.3). The shell owns navigation and auth; screens own
 * their data. Detail routes keep a real URL so inbox and dashboard links can
 * point at the exact record.
 */
const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  {
    path: '/',
    element: <AdminShell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'submissions', element: <Submissions /> },
      { path: 'submissions/:id', element: <SubmissionDetail /> },
      { path: 'pages', element: <Pages /> },
      { path: 'pages/:slug', element: <DocumentEditor /> },
      { path: 'collections/:name', element: <Collections /> },
      { path: 'collections/:name/:id', element: <EntryEditor /> },
      { path: 'media', element: <Media /> },
      { path: 'forms', element: <Forms /> },
      { path: 'settings', element: <Settings /> },
      { path: 'users', element: <Users /> },
      { path: 'audit', element: <Audit /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
