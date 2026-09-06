// A recorded BrowseRP owner may propose descriptive changes. This is provenance,
// not a new assertion that they own a Roblox experience or Discord community.
export const OWNER_UPDATE_ROLE = "Current BrowseRP listing owner";
export const OWNER_UPDATE_EVIDENCE = "This proposal comes from the account recorded as the BrowseRP listing owner. Staff must review changed public links; this is not new evidence of Roblox experience ownership.";

export function ownerUpdateBody(body) {
  if (body.platform !== "roblox") return body;
  const details = body.roblox;
  if (!details || typeof details !== "object" || Array.isArray(details)
      || Object.keys(details).some(key => !["kind", "experienceUrl", "communityGroupUrl", "joiningInstructions"].includes(key))) {
    throw Object.assign(new Error("Load your listing's current Roblox details before requesting an update."), { status: 400 });
  }
  return { ...body, roblox: { ...details, applicantRole: OWNER_UPDATE_ROLE, authorityEvidence: OWNER_UPDATE_EVIDENCE } };
}
