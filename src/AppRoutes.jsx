import { Routes, Route } from "react-router-dom"
import WellnessSurvey from "/components/WellnessSurvey";
import CompletionPage from "/components/CompletionPage";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<WellnessSurvey />} />
      <Route path="/completion" element={<CompletionPage />} />
    </Routes>
  );
}