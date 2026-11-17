// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://tdac.immigration.go.th/arrival-card/#/tac/arrival-card/add"}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEARNED_KEY } from "../../lib/keysTh";
import { withBackground } from "../../test/fakeBackground";

let root: ShadowRoot;
beforeEach(() => {
  vi.useFakeTimers(); vi.resetModules();
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  const attach = HTMLElement.prototype.attachShadow;
  vi.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(function (this: HTMLElement, options) { root = attach.call(this, options); return root; });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("on the real Thailand site", () => {
  it("the panel says it's the official site", async () => {
    document.body.innerHTML = '<div sit-validate-input="firstName"><input></div>';
    const store = { [LEARNED_KEY]: [{ key: "firstName", kind: "text", value: "ALEX", label: "First name" }] };
    (globalThis as any).chrome = withBackground({ storage: { local: { get: async () => store }, onChanged: { addListener: () => {} } } });
    const { mountPanel } = await import("./panel");
    mountPanel(); await vi.advanceTimersByTimeAsync(1);
    expect(root.querySelector(".official")?.textContent).toBe("✓ Official Thailand arrival card site: tdac.immigration.go.th");
  });
});
