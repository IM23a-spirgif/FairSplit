export type AuthUser = {
  id: string;
  name: string;
  email: string;
};

export type StoredAccount = AuthUser & {
  createdAt: string;
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
};

export type AuthSession = {
  userId: string;
};

export type AuthResult =
  | { ok: true; user: AuthUser; accounts: StoredAccount[] }
  | { ok: false; error: string };

const PASSWORD_ITERATIONS = 210_000;
const HASH_ALGORITHM = "SHA-256";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
};

const base64ToBytes = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  return copy.buffer;
};

const hashPassword = async (
  password: string,
  salt: Uint8Array,
  iterations = PASSWORD_ITERATIONS
) => {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(salt),
      iterations,
      hash: HASH_ALGORITHM,
    },
    keyMaterial,
    256
  );

  return bytesToBase64(new Uint8Array(derivedBits));
};

const createPasswordRecord = async (password: string) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));

  return {
    passwordHash: await hashPassword(password, salt),
    passwordSalt: bytesToBase64(salt),
    passwordIterations: PASSWORD_ITERATIONS,
  };
};

const toUser = (account: StoredAccount): AuthUser => ({
  id: account.id,
  name: account.name,
  email: account.email,
});

const timingSafeEqual = (left: string, right: string) => {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return diff === 0;
};

export const registerAccount = async (
  accounts: StoredAccount[],
  input: { name: string; email: string; password: string }
): Promise<AuthResult> => {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);

  if (name.length < 2) {
    return { ok: false, error: "Bitte gib einen Namen ein." };
  }

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return { ok: false, error: "Bitte gib eine gültige E-Mail ein." };
  }

  if (input.password.length < 8) {
    return { ok: false, error: "Das Passwort braucht mindestens 8 Zeichen." };
  }

  if (accounts.some((account) => account.email === email)) {
    return {
      ok: false,
      error: "Für diese E-Mail existiert bereits ein Account.",
    };
  }

  const passwordRecord = await createPasswordRecord(input.password);
  const account: StoredAccount = {
    id: crypto.randomUUID(),
    name,
    email,
    createdAt: new Date().toISOString(),
    ...passwordRecord,
  };

  return { ok: true, user: toUser(account), accounts: [...accounts, account] };
};

export const loginAccount = async (
  accounts: StoredAccount[],
  input: { email: string; password: string }
): Promise<AuthResult> => {
  const email = normalizeEmail(input.email);
  const account = accounts.find((current) => current.email === email);

  if (!account) {
    return { ok: false, error: "E-Mail oder Passwort ist falsch." };
  }

  const attemptedHash = await hashPassword(
    input.password,
    base64ToBytes(account.passwordSalt),
    account.passwordIterations
  );

  if (!timingSafeEqual(attemptedHash, account.passwordHash)) {
    return { ok: false, error: "E-Mail oder Passwort ist falsch." };
  }

  return { ok: true, user: toUser(account), accounts };
};

export const resolveSessionUser = (
  accounts: StoredAccount[],
  session: AuthSession | null
): AuthUser | null => {
  if (!session) {
    return null;
  }

  const account = accounts.find((current) => current.id === session.userId);

  return account ? toUser(account) : null;
};
