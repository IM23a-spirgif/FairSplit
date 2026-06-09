import { expect, test } from "@playwright/test";

test("registered users can invite another registered user, capture an expense, and see balances", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });

  await page.goto("/");

  await page.getByRole("button", { name: "Registrieren" }).click();
  await page.getByLabel("Name").fill("Test User");
  await page.getByLabel("E-Mail").fill("test@example.com");
  await page.getByLabel("Passwort").fill("supersecret");
  await page.getByRole("button", { name: "Account erstellen" }).click();
  await expect(page.getByLabel("Gruppenname")).toHaveValue("Neue Abrechnung");

  await page.getByRole("button", { name: "Logout" }).click();
  await page.getByRole("button", { name: "Registrieren" }).click();
  await page.getByLabel("Name").fill("Tina");
  await page.getByLabel("E-Mail").fill("tina@example.com");
  await page.getByLabel("Passwort").fill("supersecret");
  await page.getByRole("button", { name: "Account erstellen" }).click();

  await page.getByRole("button", { name: "Logout" }).click();
  await page.getByRole("button", { name: "Einloggen" }).click();
  await page.getByLabel("E-Mail").fill("test@example.com");
  await page.getByLabel("Passwort").fill("supersecret");
  await page.locator("form").getByRole("button", { name: "Einloggen" }).click();

  await page
    .getByLabel("Registrierte E-Mail einladen")
    .fill("tina@example.com");
  await page.getByLabel("Registrierten Benutzer einladen").click();
  await expect(page.getByLabel("Tina entfernen")).toBeVisible();

  await page.getByLabel("Ausgabentitel").fill("Abendessen");
  await page.getByLabel("Betrag").fill("60");
  await page.getByLabel("Notiz").fill("Pizza und Getränke");
  await page.getByLabel("Ausgabe speichern").click();

  await expect(page.getByText("Abendessen", { exact: true })).toBeVisible();
  await expect(page.getByText("Beteiligte: Test User, Tina")).toBeVisible();
  await expect(
    page.getByText("Tina zahlt CHF 30.00 an Test User.")
  ).toBeVisible();

  await page.getByLabel("Ausgaben durchsuchen").fill("Pizza");
  await expect(page.getByText("Abendessen", { exact: true })).toBeVisible();

  await page.getByLabel("Ausgaben durchsuchen").fill("Hotel");
  await expect(
    page.getByText("Noch keine passende Ausgabe vorhanden.", { exact: true })
  ).toBeVisible();
});
