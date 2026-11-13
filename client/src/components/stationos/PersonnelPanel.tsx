import { useState } from "react";
import { roleLabels, type AppState } from "@shared/station";
import { Empty, Field, Notice, Panel } from "./Common";

export function PersonnelPanel({
  state,
  busy,
  inviteCode,
  inviteEmail,
  onInvite,
  onAction,
}: {
  state: AppState;
  busy: boolean;
  inviteCode: string;
  inviteEmail: string;
  onInvite: () => void;
  onAction: (
    path: string,
    payload: Record<string, unknown>
  ) => Promise<boolean>;
}) {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [managementMessage, setManagementMessage] = useState("");
  const query = search.trim().toLocaleLowerCase("tr-TR");
  const members = state.members.filter(
    member =>
      (!role || member.role === role) &&
      (!query ||
        `${member.name} ${member.email ?? ""}`
          .toLocaleLowerCase("tr-TR")
          .includes(query))
  );
  const roles = [...new Set(state.members.map(member => member.role))];
  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopyMessage("Davet kodu kopyalandı.");
    } catch {
      setCopyMessage("Kopyalanamadı. Kodu seçerek elle kopyalayabilirsiniz.");
    }
  }
  async function updateStaffing(
    path: string,
    payload: Record<string, unknown>
  ) {
    const ok = await onAction(path, payload);
    setManagementMessage(
      ok ? "Personel kapsamı kaydedildi." : "Değişiklik uygulanmadı."
    );
  }
  return (
    <Panel
      title="Personel ve yetki kapsamı"
      subtitle="Yalnız seçili kapsamdaki firma üyeleri ve görünür istasyon yetkileri listelenir."
      action={
        <button
          className="btn primary"
          disabled={busy || state.stations.length === 0}
          onClick={onInvite}
        >
          Personel davet et
        </button>
      }
    >
      <div className="setup-form">
        <div className="form-row">
          <Field label="Ad veya e-posta ara">
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              type="search"
              placeholder="Personel ara"
            />
          </Field>
          <Field label="Rol filtresi">
            <select
              value={role}
              onChange={event => setRole(event.target.value)}
            >
              <option value="">Tüm roller</option>
              {roles.map(value => (
                <option key={value} value={value}>
                  {roleLabels[value]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p role="status">
          {members.length} / {state.members.length} kişi ·{" "}
          {state.stations.length} görünür istasyon
        </p>
        <p>
          Üyelerin diğer istasyonlardaki yetkileri bu listede görünmez. Liste
          erişim yetkisini gösterir; çevrimiçi durumunu göstermez.
        </p>
      </div>
      {!state.staffingFeaturesAvailable && (
        <Notice warning>
          İstasyon erişimini pasifleştirme ve vardiya personeli atama için
          gereken veritabanı migrationı henüz uygulanmamış. Bu işlemler kapalı;
          mevcut personel ve vardiya kayıtları korunuyor.
        </Notice>
      )}
      {managementMessage && <p role="status">{managementMessage}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Kullanıcı</th>
              <th>İstasyon personeli ve vardiya ataması</th>
              <th>Rol</th>
              <th>Görünen istasyon kapsamı</th>
            </tr>
          </thead>
          <tbody>
            {members.map(member => (
              <tr key={member.userId}>
                <td>
                  <b>
                    {member.name || "İsimsiz kullanıcı"}
                    {member.userId === state.user.id ? " (Siz)" : ""}
                  </b>
                  <small>{member.email ?? "E-posta tanımlı değil"}</small>
                </td>
                <td>
                  {["FUEL_STAFF", "MARKET_STAFF"].includes(member.role) ? (
                    <div className="form-grid">
                      {state.stations.map(station => {
                        const access =
                          member.stationAccess?.[station.id] ?? "NONE";
                        const shifts = state.shifts.filter(
                          shift =>
                            shift.stationId === station.id &&
                            shift.status === "OPEN"
                        );
                        return (
                          <section key={station.id}>
                            <label className="inline-checkbox">
                              <input
                                type="checkbox"
                                checked={access === "ACTIVE"}
                                disabled={
                                  busy || !state.staffingFeaturesAvailable
                                }
                                onChange={event =>
                                  void updateStaffing(
                                    "/personnel/station-access",
                                    {
                                      userId: member.userId,
                                      stationId: station.id,
                                      active: event.target.checked,
                                    }
                                  )
                                }
                              />
                              {station.name} ·{" "}
                              {access === "ACTIVE"
                                ? "Aktif"
                                : access === "INACTIVE"
                                  ? "Pasif"
                                  : access === "REVIEW_REQUIRED"
                                    ? "İnceleme gerekli"
                                    : "Erişim yok"}
                            </label>
                            {shifts.map(shift => (
                              <label className="inline-checkbox" key={shift.id}>
                                <input
                                  type="checkbox"
                                  checked={
                                    shift.assignedUserIds?.includes(
                                      member.userId
                                    ) ?? false
                                  }
                                  disabled={
                                    busy ||
                                    !state.staffingFeaturesAvailable ||
                                    access !== "ACTIVE"
                                  }
                                  onChange={event =>
                                    void updateStaffing(
                                      "/staff/shift-assignment",
                                      {
                                        userId: member.userId,
                                        stationId: station.id,
                                        shiftId: shift.id,
                                        assigned: event.target.checked,
                                      }
                                    )
                                  }
                                />
                                {shift.label} ·{" "}
                                {new Date(shift.startsAt).toLocaleString(
                                  "tr-TR"
                                )}
                              </label>
                            ))}
                          </section>
                        );
                      })}
                      {!member.stationIds.length && (
                        <small>Aktif istasyon erişimi yok.</small>
                      )}
                    </div>
                  ) : (
                    <small>
                      Vardiya atamas? akaryak?t ve market sat?? personeli i?in
                      kullan?l?r.
                    </small>
                  )}
                </td>
                <td>{roleLabels[member.role]}</td>
                <td>
                  {member.stationIds.length
                    ? member.stationIds
                        .map(
                          id =>
                            state.stations.find(station => station.id === id)
                              ?.name ?? "Görünür istasyon"
                        )
                        .join(", ")
                    : "Görünür istasyon yetkisi yok"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {members.length === 0 && (
        <Empty
          title="Personel bulunamadı"
          text="Arama veya rol filtresini değiştirin. Seçili istasyon kapsamında başka üye olmayabilir."
        />
      )}
      <section aria-labelledby="personnel-invitations-heading">
        <h3 id="personnel-invitations-heading">İstasyon davetleri</h3>
        {(state.invitations ?? []).length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Görev</th>
                  <th>İstasyon</th>
                  <th>Durum</th>
                  <th>Oluşturulma / son kullanım</th>
                </tr>
              </thead>
              <tbody>
                {(state.invitations ?? []).map(invitation => (
                  <tr key={invitation.id}>
                    <td>{roleLabels[invitation.role]}</td>
                    <td>
                      {invitation.stationIds
                        .map(
                          id =>
                            state.stations.find(station => station.id === id)
                              ?.name ?? "Yetkili istasyon"
                        )
                        .join(", ")}
                    </td>
                    <td>
                      {invitation.status === "PENDING"
                        ? "Bekliyor"
                        : invitation.status === "ACCEPTED"
                          ? "Kabul edildi"
                          : "Süresi doldu"}
                    </td>
                    <td>
                      {new Date(invitation.createdAt).toLocaleString("tr-TR")}
                      {" · "}
                      {new Date(invitation.expiresAt).toLocaleString("tr-TR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p role="status">Görünür istasyonlarda bekleyen davet yok.</p>
        )}
        <small>
          Davet kabulünden sonra istasyon üyeliği ayrıca incelenebilir. “İnceleme
          gerekli” üyelikler personel tablosunda gösterilir ve otomatik
          etkinleştirilmez.
        </small>
      </section>
      {inviteCode && (
        <div className="invite-result">
          <b>Tek kullanımlık davet kodu</b>
          {inviteEmail && <p>Hedef giriş hesabı: {inviteEmail}</p>}
          <code>{inviteCode}</code>
          <button className="btn small secondary" onClick={() => void copy()}>
            Kodu kopyala
          </button>
          <small>
            Kod 7 gün geçerlidir ve yalnız hedef e-postayla kabul edilir. Sistem
            e-posta göndermez; kodu hedef kişiyle güvenli biçimde paylaşın.
          </small>
          {copyMessage && <small role="status">{copyMessage}</small>}
        </div>
      )}
    </Panel>
  );
}
