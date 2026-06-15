import { useState } from "react";

export default function CompletionPage() {
    const handleClose = () => {
        // Close the window/tab
        window.close();
    };

    return (
        <div className="bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 min-h-screen flex items-center justify-center px-4 py-10">
            <div className="w-full max-w-md">
                {/* Success Card */}
                <div className="bg-white rounded-3xl shadow-xl p-8 text-center">
                    {/* Success Animation */}
                    <div className="mb-6 flex justify-center">
                        <div className="relative w-24 h-24">
                            <div className="absolute inset-0 bg-gradient-to-br from-yellow-300 to-orange-300 rounded-full animate-pulse opacity-15"></div>
                            <div className="absolute inset-2 bg-white rounded-full flex items-center justify-center">
                                <span className="text-6xl">✅</span>
                            </div>
                        </div>
                    </div>

                    {/* Main Message */}
                    <h1 className="text-3xl font-bold text-gray-900 mb-3">
                        Thank You!
                    </h1>

                    <p className="text-lg text-gray-600 mb-2">
                        Your wellness survey has been successfully submitted
                    </p>

                    <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 my-6">
                        <p className="text-sm text-amber-900">
                            ✨ Your response has been securely saved and will help us create a healthier workplace for everyone.
                        </p>
                    </div>

                    {/* Motivational Message */}
                    <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 mb-8">
                        <p className="text-sm text-orange-900 font-medium mb-2">
                            💙 Remember
                        </p>
                        <p className="text-xs text-orange-800">
                            Taking care of your wellness matters. Whether it's a few moments of rest, connecting with colleagues, or stepping outside for fresh air — prioritize yourself today.
                        </p>
                    </div>

                    {/* Redirect Message */}
                    <div className="text-center">
                        <p className="text-sm text-gray-600 mb-4">
                            You can now close this window.
                        </p>
                        <button
                            onClick={handleClose}
                            className="w-full px-6 py-3 bg-gradient-to-r from-amber-400 to-orange-400 text-white font-semibold rounded-xl hover:from-amber-500 hover:to-orange-500 transition-all duration-200 shadow-lg hover:shadow-xl"
                        >
                            Close Window
                        </button>
                    </div>

                    {/* Footer */}
                    <div className="mt-8 pt-6 border-t border-gray-200">
                        <p className="text-xs text-gray-400">
                            Your privacy is important. All responses are confidential and handled with care.
                        </p>
                    </div>
                </div>

                {/* Wellness Tip */}
                <div className="mt-6 text-center">
                    <p className="text-sm text-gray-500">
                        🌟 Check in with yourself daily for better wellness awareness
                    </p>
                </div>
            </div>
        </div>
    );
}
