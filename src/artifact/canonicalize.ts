/**
 * Vendor glossary: the same Heritage Core control under two tenant skins.
 * Canonical artifacts store namePattern so replay does not fork per institution.
 */
export const HERITAGE_NAME_ALIASES: readonly { concept: string; names: readonly string[] }[] = [
  { concept: "memberId", names: ["Member Number", "Customer No."] },
  { concept: "memberName", names: ["Member Name", "Customer Name"] },
  { concept: "balance", names: ["Share Balance", "Current Savings"] },
  { concept: "inquiry", names: ["Member Inquiry", "Customer Inquiry"] },
  { concept: "openProduct", names: ["Open Auxiliary Share", "Open Sub-Account"] },
  { concept: "confirm", names: ["Post Share", "Confirm Opening"] },
  { concept: "productType", names: ["Share Type", "Product Type"] },
  { concept: "receiptId", names: ["New Share ID", "New Sub-Account ID"] },
];

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function namePatternFor(visibleName: string): string | undefined {
  const group = HERITAGE_NAME_ALIASES.find((entry) => entry.names.includes(visibleName));
  if (!group) {
    return undefined;
  }
  return group.names.map(escapeRegex).join("|");
}

export function matchesAccessibleName(
  accessibleName: string,
  locator: { name?: string; namePattern?: string },
): boolean {
  if (locator.namePattern) {
    return new RegExp(`^(?:${locator.namePattern})$`).test(accessibleName);
  }
  if (locator.name) {
    return locator.name === accessibleName;
  }
  return false;
}

/** Attach namePattern on AX locators when the glossary knows aliases. */
export function canonicalizeLocatorName<T extends { name?: string; namePattern?: string }>(
  locator: T,
): T & { namePattern?: string } {
  if (!locator.name || locator.namePattern) {
    return locator;
  }
  const pattern = namePatternFor(locator.name);
  if (!pattern) {
    return locator;
  }
  return { ...locator, namePattern: pattern };
}
