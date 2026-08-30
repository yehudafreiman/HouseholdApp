"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/groups";
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setPending(true);

    const supabase = createClient();

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username } },
      });
      if (error) {
        setError(error.message);
        setPending(false);
        return;
      }
      if (!data.session) {
        setInfo("נרשמת בהצלחה! בדוק/י את תיבת האימייל כדי לאשר את החשבון לפני ההתחברות.");
        setPending(false);
        return;
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setError(error.message);
        setPending(false);
        return;
      }
    }

    router.push(next);
    router.refresh();
  }

  return (
    <div className="flex h-dvh items-center justify-center bg-zinc-50 dark:bg-black px-4">
      <div className="w-full max-w-sm rounded-xl bg-white dark:bg-zinc-950 p-8 shadow-raised">
        <h1 className="text-xl font-semibold text-center mb-6">
          {mode === "login" ? "התחברות" : "הרשמה"}
        </h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {mode === "signup" && (
            <div className="flex flex-col gap-1">
              <label htmlFor="username" className="text-sm font-medium">
                שם משתמש
              </label>
              <input
                id="username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="rounded-md bg-white dark:bg-zinc-900 shadow-inset px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20"
              />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-sm font-medium">
              אימייל
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md bg-zinc-200 dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-sm font-medium">
              סיסמה
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-md bg-zinc-200 dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {info && <p className="text-sm text-green-600">{info}</p>}

          <button
            type="submit"
            disabled={pending}
            className="mt-2 rounded-md bg-accent text-accent-foreground py-2 text-sm font-medium shadow-raised transition hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
          >
            {pending ? "רגע..." : mode === "login" ? "התחבר" : "הירשם"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setError(null);
            setInfo(null);
            setMode(mode === "login" ? "signup" : "login");
          }}
          className="mt-4 w-full text-center text-sm text-zinc-500 transition hover:text-zinc-800 dark:hover:text-zinc-200 active:scale-95"
        >
          {mode === "login" ? "אין לך חשבון? הירשם" : "יש לך כבר חשבון? התחבר"}
        </button>
      </div>
    </div>
  );
}
