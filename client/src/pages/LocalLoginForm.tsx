import { useState, type FormEvent } from "react";

export default function LocalLoginForm() {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/auth/${register ? "register" : "login"}`, {
        method: "POST", credentials: "include", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Stationos-Request": "1" },
        body: JSON.stringify(Object.fromEntries(form)),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "İşlem tamamlanamadı.");
      // A full navigation clears the previous user's in-memory query cache.
      window.location.assign("/");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Sunucuya ulaşılamadı.");
    } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="local-login-form">
    {register && <label>Ad soyad<input name="name" required maxLength={100} autoComplete="name" /></label>}
    <label>E-posta<input name="email" type="email" required maxLength={254} autoComplete="username" /></label>
    <label>Parola<input name="password" type="password" required minLength={12} maxLength={128} autoComplete={register ? "new-password" : "current-password"} /></label>
    <small>Parolanız en az 12 karakter olmalı.</small>
    {error && <p role="alert">{error}</p>}
    <button type="submit" className="btn primary login-button" disabled={busy}>{busy ? "Lütfen bekleyin…" : register ? "Hesap oluştur" : "Giriş yap"}</button>
    <button type="button" className="btn" disabled={busy} onClick={() => { setRegister(!register); setError(""); }}>{register ? "Zaten hesabım var" : "Yeni hesap oluştur"}</button>
    {register && <small>Yeni hesap mevcut istasyonlara erişim vermez. Firmanızı kurabilir veya yöneticinizin davetiyle katılabilirsiniz.</small>}
  </form>;
}
