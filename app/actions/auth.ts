"use server";

import { redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession } from "@/lib/auth/session";
import { validateEmail, validatePassword } from "@/lib/auth/validate";

export interface AuthFormState {
  error: string | null;
}

export async function signupAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const invalid = validateEmail(email) ?? validatePassword(password);
  if (invalid) return { error: invalid };

  const normalized = email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({
    where: { email: normalized },
  });
  if (existing) {
    return {
      error: "An account with that email already exists. Log in instead.",
    };
  }

  const user = await prisma.user.create({
    data: { email: normalized, passwordHash: await hashPassword(password) },
  });

  await createSession(user.id);
  redirect("/onboarding");
}

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const invalidEmail = validateEmail(email);
  if (invalidEmail) return { error: invalidEmail };

  // Deliberately generic: never disclose whether the email exists.
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
  });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "Incorrect email or password." };
  }

  await createSession(user.id);
  redirect(user.householdId ? "/dashboard" : "/onboarding");
}

export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}
