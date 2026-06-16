import { Routes, Route } from "react-router-dom"
import WellnessSurvey from "/components/WellnessSurvey";
import CompletionPage from "/components/CompletionPage";
import HRDashboard from "/components/HRDashboard";
import TLDashboard from "/components/TLDashboard";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<WellnessSurvey />} />
      <Route path="/completion" element={<CompletionPage />} />
      <Route path="/hr-dashboard" element={<HRDashboard />} />
      <Route path="/tl-dashboard" element={<TLDashboard />} />
    </Routes>
  );
}