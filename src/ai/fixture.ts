export type SyntheticEvidenceKind = "contract" | "test";

export interface SyntheticEvidenceDocument {
  path: string;
  kind: SyntheticEvidenceKind;
  content: string;
}

export const SYNTHETIC_AI_EVIDENCE: readonly SyntheticEvidenceDocument[] = [
  {
    path: "synthetic/api/account-export-contract.md",
    kind: "contract",
    content: [
      "# Account export contract",
      "",
      "`GET /accounts/{accountId}/export` requires authentication.",
      "An authenticated user may export only their own account.",
      "A request for another account must return HTTP 403.",
    ].join("\n"),
  },
  {
    path: "synthetic/tests/account-export.test.md",
    kind: "test",
    content: [
      "# Account export tests",
      "",
      "- The account owner receives HTTP 200 and an export document.",
      "- An unauthenticated request receives HTTP 401.",
    ].join("\n"),
  },
];
