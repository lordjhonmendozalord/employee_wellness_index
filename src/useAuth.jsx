import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { supabase } from "./supabaseClient";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);   // { id, full_name, email, role, lob, account_name }
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);

  // Fetch user profile data from system_users table
  const fetchUserProfile = useCallback(async (email) => {
    try {
      const { data, error: dbErr } = await supabase
        .from("system_users")
        .select("*")
        .eq("email", email.toLowerCase())
        .eq("is_active", true)
        .maybeSingle();

      if (dbErr) {
        console.error("Database error fetching user profile:", dbErr);
        throw new Error(`Database error: ${dbErr.message}`);
      }

      if (!data) {
        console.warn(`No user profile found for email: ${email}`);
        throw new Error("User profile not found in system_users table");
      }

      return {
        id: data.id,
        full_name: data.full_name,
        email: data.email,
        role: data.role,
        lob: data.lob,
        account_name: data.account_name,
      };
    } catch (err) {
      console.error("Error in fetchUserProfile:", err.message);
      throw err;
    }
  }, []);

  // Check for existing session on mount
  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const profile = await fetchUserProfile(session.user.email);
          setUser(profile);
        }
      } catch (err) {
        console.error("Session check error:", err);
      } finally {
        setInitializing(false);
      }
    };

    checkSession();

    // Subscribe to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      try {
        if (session?.user) {
          const profile = await fetchUserProfile(session.user.email);
          setUser(profile);
          setError("");
        } else {
          setUser(null);
        }
      } catch (err) {
        console.error("Auth state change error:", err);
        setError("Failed to load user profile");
      }
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, [fetchUserProfile]);

  const login = useCallback(async (email, password) => {
    setLoading(true);
    setError("");
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.toLowerCase(),
        password,
      });

      if (signInError) {
        setError(signInError.message || "Invalid email or password.");
        return false;
      }

      const profile = await fetchUserProfile(email);
      setUser(profile);
      return true;
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [fetchUserProfile]);

  const logout = useCallback(async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
      setError("");
    } catch (err) {
      setError("Failed to logout");
      console.error("Logout error:", err);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, error, loading, initializing }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}