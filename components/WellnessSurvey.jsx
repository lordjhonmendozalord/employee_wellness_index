import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../src/supabaseClient";

export default function WellnessSurvey() {
    const navigate = useNavigate();
    const [full_name, setFullName] = useState("");
    const [employee_id, setEmployeeId] = useState("");
    const [lob, setLob] = useState("");
    const [account_name, setAccountName] = useState("");
    const [energy_level, setEnergy] = useState("");
    const [emotion_level, setEmotion] = useState("");
    const [showSuccess, setShowSuccess] = useState(false);
    const [showWarning, setShowWarning] = useState(false);

    const dateString = new Date().toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    });

    const showToast = (type) => {
        if (type === "success") {
            setShowSuccess(true);
            setTimeout(() => setShowSuccess(false), 3000);
        } else {
            setShowWarning(true);
            setTimeout(() => setShowWarning(false), 3000);
        }
    };

    const submitSurvey = async () => {
        if (!energy_level || emotion_level === "" || !full_name || !employee_id || !lob || !account_name) {
            showToast("warning");
            return;
        }

        const { data, error } = await supabase
            .from("employee_survey")
            .insert({
                full_name,
                employee_id,
                lob,
                account_name,
                energy_level,
                emotion_level,
            });

        if (error) {
            console.error("Error inserting survey response:", error);
        } else {
            // console.log("Survey response saved:", data);
            navigate("/completion");
        }
    };

    const energyOptions = [
        { value: 5, emoji: "⚡", label: "Highly energized" },
        { value: 4, emoji: "🔋", label: "Energized" },
        { value: 3, emoji: "🙂", label: "Normal" },
        { value: 2, emoji: "😴", label: "Low energy" },
        { value: 1, emoji: "🪫", label: "Exhausted" },
    ];

    const emotionOptions = [
        { value: 5, emoji: "😀", label: "Excited" },
        { value: 4, emoji: "🟢", label: "Happy" },
        { value: 3, emoji: "🔵", label: "Motivated" },
        { value: 2, emoji: "🟡", label: "Concerned" },
        { value: 1, emoji: "🟠", label: "Stressed" },
        { value: 0, emoji: "🔴", label: "Burned out" },
    ];

    return (
        <div className="bg-gray-50 min-h-screen font-sans">
            <main className="max-w-2xl mx-auto px-4 py-10">
                {/* Survey Header */}
                <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm mb-5">
                    <div className="flex items-start justify-between flex-wrap gap-4">
                        <div>
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-medium mb-3">
                                💙 Wellness Check
                            </div>

                            <h1 className="text-2xl font-semibold text-gray-900">
                                Daily Employee Wellness Survey
                            </h1>

                            <p className="text-sm text-gray-500 mt-2 max-w-xl">
                                This quick check-in helps us understand how you're doing.
                                Your responses are confidential and used only to improve
                                team support and workplace wellbeing.
                            </p>
                        </div>
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-500">
                            📅 {dateString}
                        </div>
                    </div>
                </div>

                {/* Employee Information */}
                <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-5 shadow-sm">
                    <h2 className="text-lg font-semibold text-gray-800 mb-1">
                        Employee Information
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Name
                            </label>
                            <input
                                type="text"
                                placeholder="Enter your Full name"
                                className="w-full mb-3 px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                // value={full_name}
                                onChange={(e) => setFullName(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Employee ID
                            </label>
                            <input
                                type="text"
                                placeholder="Enter your Employee ID"
                                className="w-full mb-3 px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                // value={employee_id}
                                onChange={(e) => setEmployeeId(e.target.value)}
                            />
                        </div>
                    </div>


                    <p className="text-sm text-gray-400 mb-2">
                        Select your line of business and account.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* LOB */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Line of Business (LOB)
                            </label>

                            <select
                                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                // value={lob}
                                onChange={(e) => setLob(e.target.value)}
                            >
                                <option value="">
                                    Select LOB
                                </option>
                                <option value="TSR">
                                    TSR
                                </option>
                                <option value="CSR">
                                    CSR
                                </option>
                            </select>
                        </div>

                        {/* Account */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Account
                            </label>

                            <input
                                type="text"
                                placeholder="Enter account name"
                                // value={account_name}
                                onChange={(e) => setAccountName(e.target.value)}
                                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                    </div>
                </div>

                {/* Question 1 */}
                <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-5 shadow-sm">
                    <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">
                        Question #1
                    </p>

                    <h2 className="text-lg font-semibold text-gray-800">
                        How is your energy level today?
                    </h2>

                    <p className="text-sm text-gray-400 mb-5">
                        Please select ONE.
                    </p>

                    <div className="space-y-3">
                        {energyOptions.map((option) => (
                            <label
                                key={option.value}
                                className={`flex items-center gap-4 p-3.5 border rounded-xl cursor-pointer transition-all
                                ${
                                    energy_level === option.value
                                        ? "border-blue-600 bg-blue-50"
                                        : "border-gray-200 hover:border-blue-300 hover:bg-blue-50"
                                }`}
                            >
                                <input
                                    type="radio"
                                    className="hidden"
                                    checked={energy_level === option.value}
                                    // value={option.value}
                                    onChange={() =>
                                        setEnergy(option.value)
                                    }
                                />

                                <span
                                    className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg
                                    ${
                                        energy_level === option.value
                                            ? "bg-blue-600 text-white"
                                            : "bg-gray-100"
                                    }`}
                                >
                                    {option.emoji}
                                </span>

                                <div>
                                    <p className="text-sm font-medium text-gray-800">
                                        {option.label}
                                    </p>

                                    <p className="text-xs text-gray-400">
                                        Rating: {option.value}
                                    </p>
                                </div>
                            </label>
                        ))}
                    </div>
                </div>

                {/* Question 2 */}
                <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-8 shadow-sm">
                    <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">
                        Question #2
                    </p>

                    <h2 className="text-lg font-semibold text-gray-800">
                        How are you feeling today?
                    </h2>

                    <p className="text-sm text-gray-400 mb-5">
                        Please select ONE.
                    </p>

                    <div className="space-y-3">
                        {emotionOptions.map((option) => (
                            <label
                                key={option.value}
                                className={`flex items-center gap-4 p-3.5 border rounded-xl cursor-pointer transition-all
                                ${
                                    emotion_level === option.value
                                        ? "border-blue-600 bg-blue-50"
                                        : "border-gray-200 hover:border-blue-300 hover:bg-blue-50"
                                }`}
                            >
                                <input
                                    type="radio"
                                    className="hidden"
                                    checked={emotion_level === option.value}
                                    // value={option.value}
                                    onChange={() =>
                                        setEmotion(option.value)
                                    }
                                />

                                <span
                                    className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg
                                    ${
                                        emotion_level === option.value
                                            ? "bg-blue-600 text-white"
                                            : "bg-gray-100"
                                    }`}
                                >
                                    {option.emoji}
                                </span>

                                <p className="text-sm font-medium text-gray-800">
                                    {option.label}
                                </p>
                            </label>
                        ))}
                    </div>
                </div>

                <div className="flex justify-end">
                    <button
                        onClick={submitSurvey}
                        className="px-6 py-3 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700"
                    >
                        Submit Response
                    </button>
                </div>
            </main>

            {/* Success Toast */}
            {showSuccess && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-5 py-3 rounded-2xl shadow-lg">
                    ✅ Response submitted successfully!
                </div>
            )}

            {/* Warning Toast */}
            {showWarning && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-amber-500 text-white px-5 py-3 rounded-2xl shadow-lg">
                    ⚠️ Please answer all questions before submitting.
                </div>
            )}
        </div>
    );
}