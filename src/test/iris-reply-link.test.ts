import { describe, expect, it } from "vitest";
import { irisReplyLinkOf } from "@/lib/iris-reply";

describe("irisReplyLinkOf", () => {
  it("rend le lien d'un courrier de réponse déposé par Iris", () => {
    expect(irisReplyLinkOf({ iris_request_id: "r", iris_reference: "2026-00042", iris_url: "https://iris/x" }))
      .toEqual({ requestId: "r", reference: "2026-00042", url: "https://iris/x" });
  });
  it("rien pour un courrier ordinaire ; jamais d'URL hors https", () => {
    expect(irisReplyLinkOf({ id: "c" })).toBeNull();
    expect(irisReplyLinkOf(null)).toBeNull();
    expect(irisReplyLinkOf({ iris_request_id: "r", iris_url: "javascript:x" })?.url).toBeNull();
  });
});
