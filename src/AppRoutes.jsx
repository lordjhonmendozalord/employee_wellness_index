import { Routes, Route, Navigate } from "react-router-dom"
import WellnessSurvey from "/components/WellnessSurvey";
import CompletionPage from "/components/CompletionPage";
import HRDashboard from "/components/HRDashboard";
import TLDashboard from "/components/TLDashboard";
import LoginPage from "/components/LoginPage";
import AdminDashboard from "/components/AdminDashboard";
import ForbiddenPage from "/components/ForbiddenPage";
import { useAuth } from "./useAuth";

// Protected Route component
function ProtectedRoute({ element, allowedRoles = [] }) {
  const { user, initializing } = useAuth();
  
  if (initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if ( allowedRoles.length > 0 && !allowedRoles.includes(user.role) ) {
    return <Navigate to="/forbidden" replace />;
  }
  
  return element;
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<WellnessSurvey />} />
      <Route path="/completion" element={<CompletionPage />} />
      {/* <Route path="/admin-dashboard" element={<AdminDashboard />} /> */}
      <Route path="/admin-dashboard" element={<ProtectedRoute element={<AdminDashboard />} allowedRoles={["admin"]} />} />
      <Route path="/hr-dashboard" element={<ProtectedRoute element={<HRDashboard />} allowedRoles={["hr", "admin"]} />} />
      <Route path="/tl-dashboard" element={<ProtectedRoute element={<TLDashboard />} allowedRoles={["tl", "admin"]} />} />
      <Route path="/forbidden" element={<ForbiddenPage />} />
      <Route path="/login" element={<LoginPage />} />
    </Routes>
  );
}