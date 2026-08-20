"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getStoredSession } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (getStoredSession()) router.replace("/");
  }, [router]);

  return (
    <main className="auth-page">
      <div className="auth-page-card">
        <Link className="brand" href="/">
          <span>◉</span> FaceVision
        </Link>
        <h1>{mode === "login" ? "Sign in" : "Create your account"}</h1>
        <p className="muted small">
          {mode === "login"
            ? "Sign in to reach your camera and gallery."
            : "An account is required before you can use the app."}
        </p>

        <div className="auth-form">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {mode === "register" && (
            <input
              type="text"
              placeholder="Display name (optional)"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          )}
          <input
            type="password"
            placeholder="Password (min. 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="auth-error">{error}</p>}
          <button className="primary-btn" disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
          <button
            className="ghost-btn"
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
          >
            {mode === "login" ? "Need an account? Create one" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </main>
  );
}
