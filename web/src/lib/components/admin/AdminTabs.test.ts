import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import AdminTabs from "./AdminTabs.svelte";

afterEach(cleanup);

describe("AdminTabs keyboard model (manual activation)", () => {
  it("moves focus with arrow keys without activating tabs", async () => {
    const { getByRole } = render(AdminTabs, {
      props: { activeTab: "dashboard" },
    });
    const dashboard = getByRole("tab", { name: "Dashboard" });
    const research = getByRole("tab", { name: "2026 Research" });
    dashboard.focus();

    await fireEvent.keyDown(dashboard, { key: "ArrowRight" });

    expect(document.activeElement).toBe(research);
    expect(research.getAttribute("aria-selected")).toBe("false");
    expect(dashboard.getAttribute("aria-selected")).toBe("true");

    await fireEvent.keyDown(research, { key: "End" });
    expect(document.activeElement).toBe(getByRole("tab", { name: "Costs" }));
    expect(dashboard.getAttribute("aria-selected")).toBe("true");
  });

  it("activates the focused tab on click (Enter/Space on a button)", async () => {
    const { getByRole } = render(AdminTabs, {
      props: { activeTab: "dashboard" },
    });
    const runs = getByRole("tab", { name: "Runs" });

    await fireEvent.click(runs);

    expect(runs.getAttribute("aria-selected")).toBe("true");
    expect(runs.getAttribute("tabindex")).toBe("0");
    expect(
      getByRole("tab", { name: "Dashboard" }).getAttribute("aria-selected"),
    ).toBe("false");
  });
});
