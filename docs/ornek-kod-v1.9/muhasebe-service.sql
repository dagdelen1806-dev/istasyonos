-- AKARYAKIT V1 v1.9 — muhasebe kabul transaction örneği
--
-- BU DOSYA MIGRATION DEĞİLDİR VE ÇALIŞTIRILMAMALIDIR.
-- Hedef v1.9 tabloları (ops.employee_shift_accounts, ops.shift_account_revisions,
-- evidence.ocr_reviews, ops.shift_handover_reviews, ops.outbox_events vb.) tasarım
-- belgesinde hedef olarak geçer; bu dosya onları CREATE TABLE etmez.
-- schema-v1.4 ve schema-v1.5 de illustrative hedeflerdir. Gerçek şema keşfi,
-- migration map'i ve vendor uyarlaması yapılmadan hiçbir SQL çalıştırılmamalıdır.
--
-- :bind_name ifadeleri bilerek vendor/driver bağımsız named-bind gösterimidir.
-- PostgreSQL $1, MySQL ?, SQL Server @p1 veya ORM parametrelerine servis katmanı
-- çevirmelidir. Kimlik, tenant ve company/station/business-unit kapsamı request
-- body'den alınmaz; sunucu oturumundan ve kilitli kayıtlardan yeniden okunur.

-- ----------------------------------------------------------------------------
-- Önerilen tek transaction akışı (pseudo-SQL; tablo/kolon adları hedef sözleşmedir)
-- ----------------------------------------------------------------------------

BEGIN;

-- 0) Actor kimliği yalnız güvenilir server identity portundan gelir.
-- :approver_user_id, :tenant_id ve scope bilgileri istemcinin gönderdiği serbest
-- değerler olarak kabul edilmez. Grant hangi scope türü olursa olsun grant.tenant_id
-- hedef tenant ile eşleşmelidir; malformed target veya invalid valid_from/valid_to
-- güvenli deny sonucudur.
SELECT u.user_id,
       u.tenant_id,
       u.status,
       ura.user_role_assignment_id,
       ura.scope_type,
       ura.company_id,
       ura.station_id,
       ura.business_unit_id,
       r.role_id,
       r.role_code
  FROM core.users AS u
  JOIN core.user_role_assignments AS ura
    ON ura.tenant_id = u.tenant_id
   AND ura.user_id = u.user_id
  JOIN core.roles AS r
    ON r.tenant_id = ura.tenant_id
   AND r.role_id = ura.role_id
  JOIN core.role_permissions AS rp
    ON rp.tenant_id = r.tenant_id
   AND rp.role_id = r.role_id
 WHERE u.tenant_id = :tenant_id
   AND u.user_id = :approver_user_id
   AND u.status = 'ACTIVE'
   AND r.active = TRUE
   AND rp.permission_code = 'finance.reconcile'
   AND ura.valid_from <= :server_now
   AND (ura.valid_to IS NULL OR ura.valid_to > :server_now)
   AND ura.tenant_id = :tenant_id
   AND (
        ura.scope_type = 'TENANT'
        OR (ura.scope_type = 'COMPANY' AND ura.company_id = :company_id)
        OR (ura.scope_type = 'STATION' AND ura.station_id = :station_id)
        OR (ura.scope_type = 'BUSINESS_UNIT' AND ura.business_unit_id = :business_unit_id)
   );
-- Not: valid_from/valid_to parse edilemiyorsa satır yok sayılır/deny edilir. Scope
-- id'si veya target id'si eksikse servis satırı eşleşmiş kabul etmemelidir.

-- 1) Deadlock düzeni: her çağrıda aynı sabit sıra.
--    account -> handover/revision -> approval request -> evidence rows
-- FOR UPDATE vendor'a göre uyarlanır; lock timeout/deadlock retry policy dışında
-- bırakılır ve transaction rollback + güvenli DLQ/operasyon kuyruğu kullanılır.
SELECT account_id,
       tenant_id,
       company_id,
       station_id,
       business_unit_id,
       participant_user_id,
       state,
       current_revision
  FROM ops.employee_shift_accounts
 WHERE tenant_id = :tenant_id
   AND account_id = :account_id
 FOR UPDATE;

SELECT revision_id,
       account_id,
       revision,
       snapshot_hash,
       evidence_set_hash,
       source_cursor,
       status
  FROM ops.shift_account_revisions
 WHERE tenant_id = :tenant_id
   AND account_id = :account_id
   AND revision = :expected_revision
 FOR UPDATE;

SELECT approval_request_id,
       tenant_id,
       requested_by_user_id,
       requested_by_real_person_id,
       subject_version,
       payload_hash,
       policy_version,
       status,
       idempotency_key
  FROM ops.approval_requests
 WHERE tenant_id = :tenant_id
   AND approval_request_id = :approval_request_id
 FOR UPDATE;

-- Hedef reviewable/open ve state alanları (difference_minor, open_review_count,
-- pending_financial_info, closed) null ise servis reject etmelidir; NULL'ı false/0
-- gibi yorumlayıp kabul etmek güvenli değildir. CLOSED/non-reviewable hedef reject'tir.

-- 2) Idempotency: repository.getIdempotentResult(tx, key, payload_hash) eşdeğeri.
-- Aynı key + aynı immutable payload daha önce tamamlandıysa append/side-effect
-- tekrarlama; önceki karar güvenli biçimde replay edilir. Aynı key farklı hash taşıyorsa
-- 409/IDEMPOTENCY_CONFLICT ve ROLLBACK.
SELECT idempotency_key,
       payload_hash,
       result_json,
       created_at
  FROM ops.approval_idempotency_results
 WHERE tenant_id = :tenant_id
   AND idempotency_key = :idempotency_key
 FOR UPDATE;
-- Uygulama katmanı:
--   row yoksa devam;
--   payload_hash = :payload_hash ise result_json replay;
--   farklıysa IDEMPOTENCY_CONFLICT.

-- 3) Policy client request'inden okunmaz. Fresh target.policy_version ile server
-- policy store'dan yüklenir; required_signatures, permission_code ve allow_pending
-- burada kilitli/server-authoritative policy snapshot'ıdır.
SELECT policy_version,
       permission_code,
       required_signatures,
       allow_pending,
       active
  FROM core.approval_policies
 WHERE policy_version = :fresh_policy_version
   AND active = TRUE
 FOR UPDATE;
-- Policy bulunamazsa veya required_signatures 1/2 değilse ROLLBACK.
-- request.policy body alanı hiçbir koşulda kullanılmaz.

-- 4) Kilitler altındayken snapshot, revision, source completeness ve evidence-set
-- hash tekrar okunur. :expected_* istemci beyanıdır; authoritative değer değildir.
SELECT e.evidence_id,
       e.content_sha256,
       e.status AS evidence_status,
       r.review_revision,
       r.review_status,
       r.canonical_key,
       e.document_type,
       e.amount_minor,
       e.linked_original_evidence_id
  FROM evidence.payment_evidence AS e
  JOIN evidence.ocr_reviews AS r
    ON r.tenant_id = e.tenant_id
   AND r.evidence_id = e.evidence_id
  WHERE e.tenant_id = :tenant_id
   AND e.account_id = :account_id
   AND e.review_revision = r.review_revision
 FOR UPDATE;

-- Servis evidence_set_hash'i canonical ve sıralı biçimde yeniden hesaplar. Hash/version
-- değişmişse STALE_HANDOVER_VERSION / 409 döner. Ham OCR text, PAN, CVV, PIN, track,
-- access token veya secret bu sorguya/parametreye giremez.

-- 5) Yalnız aynı approval request + snapshot hash + revision kararları sayılır.
-- Önceki APPROVE satırları serverChecked/active/isRealUser/permissionChecked/
-- scopeChecked işaretleriyle server tarafında doğrulanmış olmalıdır. Requester veya
-- requester'ın aynı real_person_id'si hiçbir önceki imza olarak sayılamaz.
SELECT approval_request_id,
       approver_user_id,
       approver_real_person_id,
       reviewed_request_version,
       reviewed_snapshot_hash,
       active,
       is_real_user,
       server_checked,
       permission_checked,
       scope_checked,
       decision_code
  FROM ops.approval_decisions
 WHERE tenant_id = :tenant_id
   AND approval_request_id = :approval_request_id
   AND reviewed_request_version = :fresh_revision
   AND reviewed_snapshot_hash = :fresh_snapshot_hash
   AND decision_code = 'APPROVE'
 FOR UPDATE;
-- Farklı request/snapshot/revision satırları COUNT'a girmez; aynı request satırı
-- server check taşımıyorsa STALE_SIGNATURE/ROLLBACK olur.

-- 6) Domain acceptance gate (uygulama fonksiyonu ile atomik transaction içinde):
--    * actor ACTIVE gerçek user + finance.reconcile aktif, aynı tenant scoped permission
--    * target reviewable ve açık; null state alanları kabul edilmez
--    * requester/self real person approval yok
--    * fresh snapshot hash/revision/request id eşleşir
--    * open review/fark sıfır ve state eksiksizdir
--    * required_signatures 1 veya 2; iki ise COUNT(DISTINCT real_person_id)
--    * pending_financial_info varsa policy.allow_pending=TRUE, iki imza ve explicit reason
--      yoksa FINANCIAL_PENDING_POLICY
--
-- İlk iki-imza kararı exception atmaz: decision append edilir ve sonuç
-- PENDING_APPROVAL'dır. Operational status ACCEPTED yapılmaz. İkinci checked imza
-- geldikten sonra ACCEPTED/ACCEPTED_WITH_PENDING projection'ına geçilebilir.

-- 7) Her imza append-only yazılır. Existing evidence, source satış ve orijinal
-- personel beyanı UPDATE/DELETE edilmez. Bu INSERT ilk imzayı da kalıcı karar olarak
-- tutar; immutable garantisi için gerçek DB'de constraint/trigger/append-only tablo
-- politikası gerekir, yalnız in-memory projection yeterli değildir.
INSERT INTO ops.approval_decisions (
    tenant_id,
    approval_request_id,
    approver_user_id,
    approver_real_person_id,
    user_role_assignment_id,
    reviewed_request_version,
    reviewed_snapshot_hash,
    decision_code,
    server_checked,
    permission_checked,
    scope_checked,
    reason_text,
    idempotency_key,
    decided_at
) VALUES (
    :tenant_id,
    :approval_request_id,
    :approver_user_id,
    :server_real_person_id,
    :server_user_role_assignment_id,
    :fresh_revision,
    :fresh_snapshot_hash,
    'APPROVE',
    TRUE,
    TRUE,
    TRUE,
    :reason_text,
    :idempotency_key,
    :server_now
);

-- 8) Operational projection: result.approval_status'a göre ayrılır.
-- İlk imzada aşağıdaki ACCEPTED update'i yapılmaz; pending projection/status event
-- yazılır. İkinci imza tamamlanırsa ancak o zaman accepted projection yazılır.
--
-- PENDING_APPROVAL yolu:
UPDATE ops.shift_handover_reviews
   SET status = 'PENDING_APPROVAL',
       row_version = row_version + 1
 WHERE tenant_id = :tenant_id
   AND handover_id = :handover_id
   AND account_revision = :expected_revision;

-- ACCEPTED yolu (yalnız required signature sayısı tamamlandıysa):
-- UPDATE ... SET status = :operational_status -- ACCEPTED veya ACCEPTED_WITH_PENDING
--              , financial_status = :financial_status -- COMPLETE veya PENDING
--              , row_version = row_version + 1
-- WHERE tenant_id = :tenant_id ...;
-- Pending finansal bilgi acceptance olsa bile aşağıdaki finansal posting'ler yoktur:
--    NO INSERT ops.sales
--    NO INSERT ops.sale_payments
--    NO INSERT ar.receivable_entries
--    NO INSERT ops.cash_handovers

-- 9) Outbox aynı transaction'da, status ile tutarlı event adıyla ve unique idempotency
-- key ile yazılır. Consumer ayrıca idempotent olmalıdır; AR/cash/fiscal posting burada yoktur.
INSERT INTO ops.outbox_events (
    tenant_id,
    event_id,
    event_type,
    aggregate_type,
    aggregate_id,
    aggregate_revision,
    idempotency_key,
    actor_user_id,
    payload,
    created_at
) VALUES (
    :tenant_id,
    :event_id,
    CASE WHEN :approval_status = 'PENDING_APPROVAL'
         THEN 'shift.handover.accounting-pending-approval'
         ELSE 'shift.handover.accounting-accepted'
    END,
    'employee_shift_account',
    :account_id,
    :expected_revision,
    :idempotency_key,
    :approver_user_id,
    :sanitized_event_payload,
    :server_now
);

-- 10) Yeni karar sonucu ve payload hash aynı transaction'da idempotency store'a yazılır.
-- Unique (tenant_id, idempotency_key) conflict gerçek adapter'da aynı hash replay,
-- farklı hash conflict davranışına çevrilmelidir.
INSERT INTO ops.approval_idempotency_results (
    tenant_id,
    idempotency_key,
    payload_hash,
    result_json,
    created_at
) VALUES (
    :tenant_id,
    :idempotency_key,
    :payload_hash,
    :sanitized_result_json,
    :server_now
);

-- 11) COMMIT yalnız append, pending/accepted projection, outbox ve idempotency yazımı
-- başarılıysa yapılır. Her stale hash, scope/self-approval, policy, idempotency veya
-- constraint hatası ROLLBACK; güvenli conflict/review sonucu. Orijinal kanıt ve karar
-- satırları silinmez.
COMMIT;

-- ----------------------------------------------------------------------------
-- Adapter notları
-- ----------------------------------------------------------------------------
-- 1. Tablo/kolon adları v1.9 tasarım hedefidir; mevcut v1.4/v1.5 DDL'de aynen
--    bulunmayabilir. Önce gerçek şema ve ORM migration map'i çıkarılmalıdır.
-- 2. FOR UPDATE, named binds, JSON, unique conflict ve transaction isolation gerçek
--    vendor/driver'a uyarlanmalıdır; otomatik migration değildir.
-- 3. Server identity, policy version, permission scope, real-person identity, current
--    time, source cursor ve expected snapshot client tarafından override edilemez.
-- 4. Row lock sonrası evidence hash yeniden okunmadan eski muhasebe imzası yeniden
--    kullanılamaz. Yeni evidence/revision yeni inceleme ister.
-- 5. Retry-After provider cap'ini aşarsa HTTP retry daha erken yapılmaz; DLQ/manual veya
--    harici scheduled queue seçimi worker/adapter sorumluluğudur. Timeout bilinmeyen
--    fiscal sonucu olduğu için fiscal write yapılmadan DLQ'da kalır.
