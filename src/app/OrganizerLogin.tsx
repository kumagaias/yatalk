import { ArrowLeft, KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { post } from "../lib/api";
import { BrandHeader } from "../components/BrandHeader";
import { Alert } from "../components/Feedback";

export function OrganizerLogin() {
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessCode.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await post<void>("/api/organizer/session", { accessCode });
      navigate("/dashboard", { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We could not sign you in. Check the code and retry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <BrandHeader />
      <main className="auth-shell">
        <section className="auth-card" aria-labelledby="organizer-heading">
          <span className="auth-symbol"><KeyRound size={22} aria-hidden="true" /></span>
          <p className="eyebrow">For the people behind the stall</p>
          <h1 id="organizer-heading">Organizer sign in</h1>
          <p className="auth-intro">Use your event access code to open today’s orders and stock desk.</p>
          <form onSubmit={submit}>
            <div className="form-field">
              <label htmlFor="access-code">Access code</label>
              <input id="access-code" type="password" maxLength={128} autoComplete="current-password" required value={accessCode} onChange={(event) => setAccessCode(event.target.value)} />
              <p className="form-help">The code is checked securely and never displayed back to you.</p>
            </div>
            {error && <Alert>{error}</Alert>}
            <button className="button button-primary" type="submit" disabled={!accessCode.trim() || busy}>{busy ? "Checking code…" : "Open organizer desk"}</button>
          </form>
          <Link className="back-link" to="/"><ArrowLeft size={15} aria-hidden="true" />Back to the market</Link>
        </section>
      </main>
    </div>
  );
}
