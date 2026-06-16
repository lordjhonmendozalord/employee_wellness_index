import { useState } from "react";
import { supabase } from "../src/supabaseClient";

export default function ExportSurveyButton() {
  const [showModal, setShowModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const [loading, setLoading] = useState(false);

  const exportCSV = async () => {
    if (!selectedDate) {
      alert("Please select a date.");
      return;
    }

    try {
      setLoading(true);

      const startDate = `${selectedDate}T00:00:00+08:00`;
      const endDate = `${selectedDate}T23:59:59+08:00`;

      const { data, error } = await supabase
        .from("employee_survey")
        .select("*")
        .gte("created_at", startDate)
        .lte("created_at", endDate)
        .order("created_at", { ascending: true });

      if (error) throw error;

      if (!data || data.length === 0) {
        alert("No records found for the selected date.");
        return;
      }

      const headers = [
        "ID",
        "Full Name",
        "Employee ID",
        "LOB",
        "Account Name",
        "Energy Level",
        "Emotion Level",
        "Created At",
      ];

      const rows = data.map((row) => [
        row.id,
        `"${(row.full_name || "").replace(/"/g, '""')}"`,
        `"${(row.employee_id || "").replace(/"/g, '""')}"`,
        `"${(row.lob || "").replace(/"/g, '""')}"`,
        `"${(row.account_name || "").replace(/"/g, '""')}"`,
        row.energy_level,
        row.emotion_level,
        `"${new Date(row.created_at).toLocaleString("en-PH")}"`,
      ]);

      const csvContent = [
        headers.join(","),
        ...rows.map((row) => row.join(",")),
      ].join("\n");

      const blob = new Blob([csvContent], {
        type: "text/csv;charset=utf-8;",
      });

      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.setAttribute(
        "download",
        `employee-survey-${selectedDate}.csv`
      );

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      URL.revokeObjectURL(url);

      setShowModal(false);
      setSelectedDate("");
    } catch (err) {
      console.error(err);
      alert("Failed to export data.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="px-4 py-1 text-sm bg-green-600 text-white rounded-full hover:bg-green-700"
      >
        Export CSV
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-sm">
            <h2 className="text-lg font-semibold mb-4">
              Export Survey Data
            </h2>

            <label className="block text-sm font-medium mb-2">
              Select Date
            </label>

            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full border rounded px-3 py-2 mb-4"
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowModal(false);
                  setSelectedDate("");
                }}
                className="px-4 py-2 border rounded"
                disabled={loading}
              >
                Cancel
              </button>

              <button
                onClick={exportCSV}
                disabled={loading}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                {loading ? "Exporting..." : "Export"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}