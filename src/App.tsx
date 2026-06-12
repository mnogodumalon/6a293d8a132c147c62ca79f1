import '@/lib/sentry';
import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { ActionsProvider } from '@/context/ActionsContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ErrorBusProvider } from '@/components/ErrorBus';
import { Layout } from '@/components/Layout';
import DashboardOverview from '@/pages/DashboardOverview';
import AdminPage from '@/pages/AdminPage';
import FerienwohnungenPage from '@/pages/FerienwohnungenPage';
import FerienwohnungenDetailPage from '@/pages/FerienwohnungenDetailPage';
import BuchungenPage from '@/pages/BuchungenPage';
import BuchungenDetailPage from '@/pages/BuchungenDetailPage';
import PublicFormFerienwohnungen from '@/pages/public/PublicForm_Ferienwohnungen';
import PublicFormBuchungen from '@/pages/public/PublicForm_Buchungen';
// <public:imports>
// </public:imports>
// <custom:imports>
// </custom:imports>

export default function App() {
  return (
    <ErrorBoundary>
      <ErrorBusProvider>
        <HashRouter>
          <ActionsProvider>
            <Routes>
              <Route path="public/6a293d78523cacb6cdbf4f0d" element={<PublicFormFerienwohnungen />} />
              <Route path="public/6a293d7b075920351b0a17fc" element={<PublicFormBuchungen />} />
              {/* <public:routes> */}
              {/* </public:routes> */}
              <Route element={<Layout />}>
                <Route index element={<DashboardOverview />} />
                <Route path="ferienwohnungen" element={<FerienwohnungenPage />} />
                <Route path="ferienwohnungen/:id" element={<FerienwohnungenDetailPage />} />
                <Route path="buchungen" element={<BuchungenPage />} />
                <Route path="buchungen/:id" element={<BuchungenDetailPage />} />
                <Route path="admin" element={<AdminPage />} />
                {/* <custom:routes> */}
                {/* </custom:routes> */}
              </Route>
            </Routes>
          </ActionsProvider>
        </HashRouter>
      </ErrorBusProvider>
    </ErrorBoundary>
  );
}
