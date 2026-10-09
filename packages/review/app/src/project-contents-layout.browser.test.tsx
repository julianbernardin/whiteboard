import * as stylex from "@stylexjs/stylex";
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { documentStyles } from "./document-styles";
import { documentMarker } from "./markers.stylex";
import { type ReviewRoots, ReviewRootsProvider } from "./review-root-context";
import { ReviewToc } from "./review-toc";
import { shellStyles } from "./shell-styles";

import "./styles.css";

const entries = [
  { id: "section-1", text: "First", level: "h2" as const },
  { id: "section-2", text: "Second", level: "h2" as const },
  { id: "section-3", text: "Third", level: "h2" as const },
  { id: "section-4", text: "Fourth", level: "h2" as const },
  { id: "section-5", text: "Fifth", level: "h2" as const },
  { id: "subsection", text: "Detail", level: "h3" as const },
];

const mounted: Array<ReturnType<typeof createRoot>> = [];

afterEach(() => {
  act(() => mounted.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
});

async function mountProject(
  width: number,
  mode: "standard" | "wide" | "full",
  headings = entries,
) {
  const docked = width >= 1050 && headings.length >= 2;
  const app = document.createElement("div");
  app.className = "review-canvas-root review-app";
  app.setAttribute("data-document-width", mode);
  document.body.append(app);
  const shell = document.createElement("main");
  shell.className = stylex.props(
    shellStyles.documentShell,
    docked && shellStyles.projectShellExpanded,
  ).className!;
  shell.style.width = `${width}px`;
  shell.style.height = "800px";
  app.append(shell);

  const roots: ReviewRoots = {
    appRef: { current: app },
    shellRef: { current: shell },
    scrollRegionRef: createRef<HTMLElement>(),
    articleRef: createRef<HTMLElement>(),
  };
  const root = createRoot(shell);
  mounted.push(root);
  const render = (expanded: boolean) =>
    root.render(
      <ReviewRootsProvider roots={roots}>
        <header {...stylex.props(docked && shellStyles.projectGridSpan)} />
        <ReviewToc
          entries={headings}
          project
          projectDocked={docked}
          projectExpanded={expanded}
          onProjectExpandedChange={(next) => void act(() => render(next))}
          documentWidth={mode}
        />
        <section
          ref={roots.scrollRegionRef}
          className={
            stylex.props(
              shellStyles.viewRegion,
              shellStyles.reviewRegion,
              shellStyles.projectReviewRegion,
              docked && shellStyles.projectDockedRegion,
            ).className
          }
        >
          <article
            ref={roots.articleRef}
            data-kind="project"
            className={
              stylex.props(
                documentStyles.article,
                documentStyles.projectArticle,
                documentMarker,
              ).className
            }
          >
            <h1 {...stylex.props(documentStyles.h1)}>Project title</h1>
            {headings.map((entry) =>
              entry.level === "h2" ? (
                <div key={entry.id}>
                  <h2 id={entry.id} {...stylex.props(documentStyles.h2)}>
                    {entry.text}
                  </h2>
                  <div style={{ height: "300px" }} />
                </div>
              ) : (
                <div key={entry.id}>
                  <h3 id={entry.id} {...stylex.props(documentStyles.h3)}>
                    {entry.text}
                  </h3>
                  <div style={{ height: "300px" }} />
                </div>
              ),
            )}
            <pre data-testid="code-peek">code_peek</pre>
          </article>
        </section>
      </ReviewRootsProvider>,
    );
  await act(async () => render(true));
  return { shell, docked, render };
}

describe("Project contents geometry", () => {
  it.each(["standard", "wide", "full"] as const)(
    "keeps the dock beside %s content and gives space back when hidden",
    async (mode) => {
      const { shell, render } = await mountProject(1660, mode);
      const toc = shell.querySelector<HTMLElement>("#review-toc")!;
      const article = shell.querySelector<HTMLElement>("article")!;
      const region = shell.querySelector<HTMLElement>("section")!;
      const code = shell.querySelector<HTMLElement>("pre")!;
      const title = shell.querySelector<HTMLElement>("h1")!;
      const expandedLeft = article.getBoundingClientRect().left;
      expect(toc.getBoundingClientRect().right).toBeLessThanOrEqual(
        expandedLeft,
      );
      expect(expandedLeft - region.getBoundingClientRect().left).toBeLessThan(
        70,
      );
      expect(title.getBoundingClientRect().left - expandedLeft).toBeLessThan(
        70,
      );
      expect(code.getBoundingClientRect().right).toBeLessThanOrEqual(
        region.getBoundingClientRect().right,
      );
      const toggle = toc.querySelector<HTMLButtonElement>(
        '[aria-controls="review-toc-body"]',
      )!;
      expect(toggle.hidden).toBe(false);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      toggle.focus();
      await act(async () => toggle.click());
      shell.className = stylex.props(
        shellStyles.documentShell,
        shellStyles.projectShellCollapsed,
      ).className!;
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(toggle);
      expect(article.getBoundingClientRect().left).toBeLessThan(expandedLeft);
      await act(async () => toggle.click());
      shell.className = stylex.props(
        shellStyles.documentShell,
        shellStyles.projectShellExpanded,
      ).className!;
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(article.getBoundingClientRect().left).toBeCloseTo(expandedLeft, 0);
      const lastHeading =
        toc.querySelectorAll<HTMLButtonElement>("li > button")[5]!;
      await act(async () => lastHeading.click());
      expect(lastHeading.getAttribute("aria-current")).toBe("location");
      expect(region.scrollTop).toBeGreaterThan(0);
      lastHeading.focus();
      await act(async () =>
        lastHeading.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
      );
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(toggle);
      await act(async () => render(true));
    },
  );

  it.each([1050, 1360, 850, 600, 320])(
    "keeps Project content inside a %spx shell",
    async (width) => {
      const { shell, docked } = await mountProject(width, "full");
      const toc = shell.querySelector<HTMLElement>("#review-toc")!;
      const article = shell.querySelector<HTMLElement>("article")!;
      const region = shell.querySelector<HTMLElement>("section")!;
      expect(article.getBoundingClientRect().right).toBeLessThanOrEqual(
        region.getBoundingClientRect().right + 1,
      );
      expect(region.scrollWidth).toBeLessThanOrEqual(region.clientWidth + 1);
      if (docked) {
        expect(toc.getBoundingClientRect().right).toBeLessThanOrEqual(
          article.getBoundingClientRect().left,
        );
      } else {
        expect(toc.querySelector<HTMLButtonElement>("button")?.hidden).toBe(
          false,
        );
      }
    },
  );

  it.each([0, 1])(
    "does not reserve a sidebar for %s heading(s)",
    async (count) => {
      const { shell } = await mountProject(
        1660,
        "standard",
        entries.slice(0, count),
      );
      expect(shell.querySelector("#review-toc")).toBeNull();
      const article = shell.querySelector<HTMLElement>("article")!;
      const region = shell.querySelector<HTMLElement>("section")!;
      expect(article.getBoundingClientRect().left).toBeLessThan(
        region.getBoundingClientRect().left + 70,
      );
    },
  );
});
