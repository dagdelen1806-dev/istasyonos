import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { StationError } from "./types";

const marker = "stationos-invitation-aes256gcm-v1";
export type InvitationContext = {
  actorId: number;
  requestId: string;
  payloadHash: string;
};
type InvitationResponse = {
  ok: true;
  result: {
    code: string;
    expiresAt: string;
    invitedEmail?: string;
  };
};

function keyFor(id: string): Buffer {
  try {
    const keys = JSON.parse(process.env.INVITATION_RESPONSE_KEYS ?? "{}");
    const encoded = Object.hasOwn(keys, id) ? keys[id] : undefined;
    if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(encoded))
      throw new Error();
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32 || key.toString("base64") !== encoded)
      throw new Error();
    return key;
  } catch {
    throw new StationError(
      "INVITATION_KEY_UNAVAILABLE",
      "Davet güvenlik anahtarı yapılandırılmamış veya kullanılamıyor.",
      503
    );
  }
}

function aad(context: InvitationContext, keyId: string): Buffer {
  return Buffer.from(
    JSON.stringify([
      marker,
      keyId,
      context.actorId,
      context.requestId,
      context.payloadHash,
    ])
  );
}

export function isEncryptedInvitation(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).format === marker
  );
}

export function sealInvitation(
  response: InvitationResponse,
  context: InvitationContext
): string {
  const keyId = process.env.INVITATION_RESPONSE_ACTIVE_KEY ?? "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyId))
    throw new StationError(
      "INVITATION_KEY_UNAVAILABLE",
      "Davet güvenlik anahtarı seçilmemiş.",
      503
    );
  const key = keyFor(keyId);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad(context, keyId));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(response), "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    format: marker,
    keyId,
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  });
}

/** Legacy plaintext is read only; migration/cleanup is a separate authorized task. */
export function openInvitation(
  stored: string,
  context: InvitationContext
): InvitationResponse {
  try {
    let value = JSON.parse(stored);
    if (isEncryptedInvitation(value)) {
      const key = keyFor(value.keyId);
      const nonce = Buffer.from(value.nonce, "base64");
      const tag = Buffer.from(value.tag, "base64");
      if (nonce.length !== 12 || tag.length !== 16) throw new Error();
      const decipher = createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAAD(aad(context, value.keyId));
      decipher.setAuthTag(tag);
      const clear = Buffer.concat([
        decipher.update(Buffer.from(value.ciphertext, "base64")),
        decipher.final(),
      ]);
      value = JSON.parse(clear.toString("utf8"));
    }
    if (
      value?.ok !== true ||
      typeof value.result?.code !== "string" ||
      typeof value.result?.expiresAt !== "string" ||
      (value.result.invitedEmail !== undefined &&
        (typeof value.result.invitedEmail !== "string" ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
            value.result.invitedEmail
          )))
    )
      throw new Error();
    return {
      ok: true,
      result: {
        code: value.result.code,
        expiresAt: value.result.expiresAt,
        ...(typeof value.result.invitedEmail === "string"
          ? { invitedEmail: value.result.invitedEmail }
          : {}),
      },
    };
  } catch (error) {
    if (error instanceof StationError) throw error;
    throw new StationError(
      "INVITATION_RESPONSE_UNAVAILABLE",
      "Önceki davet yanıtı güvenle okunamadı; aynı işlem kimliğini koruyun.",
      503
    );
  }
}
