import { createContext, useContext, useState, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);   // { id, full_name, email, role, lob, account_name }
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const login = useCallback(async (email, password) => {
    setLoading(true);
    setError("");
    try {
      // Fetch user by email
      const { data, error: dbErr } = await supabase
        .from("system_users")
        .select("*")
        .eq("email", email.trim().toLowerCase())
        .eq("is_active", true)
        .single();

      if (dbErr || !data) {
        setError("Invalid email or password.");
        return false;
      }

      // ⚠️  In production: call your backend API to verify bcrypt hash.
      // Never compare password hashes client-side.
      // For development/demo, we do a plaintext match against a "demo_password"
      // column, OR call a Supabase Edge Function:
      //
      //   const res  = await fetch("/api/login", { method:"POST", body: JSON.stringify({ email, password }) });
      //   const json = await res.json();
      //   if (!json.ok) { setError(json.message); return false; }
      //   setUser(json.user);
      //   return true;
      //
      // DEMO fallback — match against demo_password field or hardcoded default:
      const passwordMatch = password === (data.demo_password ?? "password");
      if (!passwordMatch) {
        setError("Invalid email or password.");
        return false;
      }

      setUser({
        id:           data.id,
        full_name:    data.full_name,
        email:        data.email,
        role:         data.role,          // "admin" | "hr" | "tl"
        lob:          data.lob,
        account_name: data.account_name,
      });
      return true;
    } catch {
      setError("Something went wrong. Please try again.");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => setUser(null), []);

  return (
    <AuthContext.Provider value={{ user, login, logout, error, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}