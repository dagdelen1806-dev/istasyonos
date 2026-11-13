export const OPERATION_VERSION = 2;
export const RECOVERABLE_OPERATIONS = [
  "/shift/close",
  "/tanker-document/import",
  "/tanker-document/read",
  "/tanker-document/review",
  "/daily-report/ocr",
  "/daily-report/numeric",
  "/daily-report/import",
  "/daily-report/review",
  "/tank/dual-measure",
  "/tank/variance-request",
  "/tank/variance-review",
  "/tank/photo-review",
  "/tank/card",
  "/tank/request",
  "/tank/review",
  "/tank/measure",
  "/tank/link",
  "/icmal/special",
  "/icmal/review",
  "/icmal/settle",
  "/icmal/void",
  "/icmal/tank",
  "/fuel/equipment",
  "/fuel/price",
  "/fuel/close",
  "/fuel/correct",
  "/company",
  "/station",
  "/invite",
  "/personnel/station-access",
  "/staff/shift-assignment",
  "/shift",
  "/account/open",
  "/payment",
  "/slip",
  "/pos-slip-draft/import",
  "/pos-slip-draft/read",
  "/pos-slip-draft/confirm",
  "/account/source",
  "/account/submit",
  "/account/cash-receive",
  "/account/approve",
  "/account/return",
  "/debtor",
  "/collection",
  "/product",
  "/stock",
  "/supplier",
  "/payable",
  "/terminal",
] as const;
export type RecoverableOperation = (typeof RECOVERABLE_OPERATIONS)[number];
export type OperationState =
  | "NOT_FOUND"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "UNCERTAIN";
export type OperationResponse = { ok: true; result: Record<string, unknown> };
export type OperationStatus = {
  ok: true;
  state: OperationState;
  message: string;
  response?: OperationResponse;
  errorCode?: string;
  retryAfterMs?: number;
};
export const UNCERTAIN_MESSAGE =
  "İşlemin sonucu henüz doğrulanamadı. Tekrar kayıt oluşturmadan önce işlem durumunu kontrol ediyoruz.";
export const OPERATION_MESSAGES: Record<OperationState, string> = {
  NOT_FOUND:
    "İşlem kaydı bulunamadı. Bu yanıt tek başına mali etkinin oluşmadığını kanıtlamaz. Yeni kayıt oluşturmayın; aynı işlem kimliğiyle inceleyin.",
  IN_PROGRESS: UNCERTAIN_MESSAGE,
  COMPLETED: "İşlem tamamlandı; daha önce kaydedilen sonuç doğrulandı.",
  FAILED:
    "İşlem başarısız oldu ve mali transaction geri alındı. Yeni kayıt öncesinde sonucu gözden geçirin.",
  UNCERTAIN: `${UNCERTAIN_MESSAGE} Sonuç kesinleştirilemezse işlem kimliğiyle yönetici incelemesi isteyin.`,
};
export function operationStatus(state: OperationState): OperationStatus {
  return {
    ok: true,
    state,
    message: OPERATION_MESSAGES[state],
    ...(state === "IN_PROGRESS" ? { retryAfterMs: 2000 } : {}),
  };
}
export function isRecoverableOperation(
  value: string
): value is RecoverableOperation {
  return (RECOVERABLE_OPERATIONS as readonly string[]).includes(value);
}
