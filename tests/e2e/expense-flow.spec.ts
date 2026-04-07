import { expect, test } from "@playwright/test";

test("users can add a participant, capture an expense, and see balances", async ({
  page,
}) => {
  const participantSection = page
    .getByRole("heading", {
      name: "Teilnehmer & Rollen",
    })
    .locator("..");

  await page.addInitScript(() => {
    window.localStorage.clear();
  });

  await page.goto("/");

  await expect(page.getByLabel("Gruppenname")).toHaveValue(
    "FairSplit - Ausgaben-Splitter"
  );

  await page.getByLabel("Teilnehmername").fill("Tina");
  await page.getByLabel("Teilnehmer hinzufügen").click();
  await expect(
    participantSection.getByText("Tina", { exact: true }).first()
  ).toBeVisible();

  await page.getByLabel("Ausgabentitel").fill("Abendessen");
  await page.getByLabel("Betrag").fill("60");
  await page.getByLabel("Notiz").fill("Pizza und Getranke");
  await page.getByLabel("Ausgabe speichern").click();

  await expect(page.getByText("Abendessen", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Beteiligte: Alex, Mira, Sam, Tina")
  ).toBeVisible();
  await expect(page.getByText("Mira zahlt CHF 15.00 an Alex.")).toBeVisible();
  await expect(page.getByText("Sam zahlt CHF 15.00 an Alex.")).toBeVisible();
  await expect(page.getByText("Tina zahlt CHF 15.00 an Alex.")).toBeVisible();

  await page.getByLabel("Ausgaben durchsuchen").fill("Pizza");
  await expect(page.getByText("Abendessen", { exact: true })).toBeVisible();

  await page.getByLabel("Ausgaben durchsuchen").fill("Hotel");
  await expect(
    page.getByText("Noch keine Ausgaben gespeichert.", { exact: true })
  ).toBeVisible();
});
