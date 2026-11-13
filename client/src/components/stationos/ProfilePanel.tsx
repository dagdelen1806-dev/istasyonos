import { useState, type FormEvent } from "react";
import { Field, Panel } from "./Common";

export function ProfilePanel({
  name,
  email,
}: {
  name: string;
  email: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setError("");
    setSuccess(false);
    if (fields.get("newPassword") !== fields.get("confirmPassword")) {
      setError("Yeni şifreler eşleşmiyor.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-Stationos-Request": "1",
        },
        body: JSON.stringify({
          currentPassword: fields.get("currentPassword"),
          newPassword: fields.get("newPassword"),
        }),
      });
      const data = await response.json();
      if (!response.ok || data.ok !== true)
        throw new Error(
          data.error?.message ?? "Şifre değişikliği doğrulanamadı."
        );
      form.reset();
      setSuccess(true);
    } catch (failure) {
      setError(
        failure instanceof TypeError
          ? "Sunucu yanıtı alınamadı. Şifre değişmiş olabilir; otomatik tekrar yapılmadı. Yeni şifreyle giriş durumunu kontrol edin."
          : failure instanceof Error
            ? failure.message
            : "Şifre değişikliği doğrulanamadı."
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      title="Profilim"
      subtitle={`${name} · ${email ?? "E-posta tanımlı değil"}`}
    >
      <form className="setup-form" onSubmit={submit}>
        <h3>Şifre değiştir</h3>
        <p>
          Şifreniz 12–128 karakter olmalı. Değişiklik sonrası diğer
          oturumlarınız kapatılır; bu oturum açık kalır.
        </p>
        <Field label="Mevcut şifre">
          <input
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            minLength={12}
            maxLength={128}
            disabled={busy}
          />
        </Field>
        <Field label="Yeni şifre">
          <input
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            disabled={busy}
          />
        </Field>
        <Field label="Yeni şifre tekrar">
          <input
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            disabled={busy}
          />
        </Field>
        {error && <p role="alert">{error}</p>}
        {success && (
          <p role="status">
            Şifreniz değiştirildi. Diğer oturumlarınız kapatıldı.
          </p>
        )}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Değiştiriliyor…" : "Şifreyi değiştir"}
        </button>
      </form>
    </Panel>
  );
}
