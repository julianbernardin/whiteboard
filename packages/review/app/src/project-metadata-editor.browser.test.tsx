import type { Snapshot } from "@review/review-api/store";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { ReviewSessionProvider } from "./host/review-session";
import { ProjectMetadataEditor } from "./project-metadata-editor";
import {
  testApiDocumentData,
  testReviewSession,
} from "./review-session-test-utils";

let container: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

it("edits title and ordered HTTPS links with keyboard focus in a narrow viewport", async () => {
  let snapshot: Snapshot = {
    ...testApiDocumentData([]).snapshot,
    kind: "project",
    title: "Alpha",
    project: { links: ["https://first.test/one"] },
    pins: undefined,
    target: undefined,
  };
  const commands: string[] = [];
  const session = testReviewSession(
    {},
    {
      request: async (url, init) => {
        if (String(url).endsWith("/commands")) {
          const operation = JSON.parse(String(init?.body)).operation;
          commands.push(operation.type);
          snapshot =
            operation.type === "rename"
              ? {
                  ...snapshot,
                  title: operation.title,
                  version: snapshot.version + 1,
                }
              : {
                  ...snapshot,
                  project: { links: operation.links },
                  version: snapshot.version + 1,
                };
          return Response.json(snapshot);
        }
        return Response.json(snapshot);
      },
    },
  );
  container = document.createElement("div");
  container.style.width = "320px";
  document.body.append(container);
  root = createRoot(container);
  const render = async () =>
    act(async () =>
      root!.render(
        <ReviewSessionProvider session={session}>
          <ProjectMetadataEditor snapshot={snapshot} />
        </ReviewSessionProvider>,
      ),
    );
  const button = (text: string) =>
    [...container!.querySelectorAll("button")].find(
      (item) => item.textContent === text,
    )!;
  await render();
  expect(button("Edit project")).toBeTruthy();
  const first = container.querySelector("a")!;
  expect(first.textContent).toBe("first.test");
  expect(first.title).toBe("https://first.test/one");
  expect(first.getAttribute("aria-label")).toBe("https://first.test/one");
  expect(first.target).toBe("_blank");
  expect(first.rel).toBe("noopener noreferrer");

  await act(async () => userEvent.click(button("Edit project")));
  const title = container.querySelector("input")!;
  const links = container.querySelector("textarea")!;
  expect(document.activeElement).toBe(title);
  expect(title.labels?.[0]?.textContent).toBe("Title");
  expect(links.labels?.[0]?.textContent).toContain("Links");
  expect(links.value).toBe("https://first.test/one");
  await act(async () => userEvent.fill(title, "Alpha draft"));
  await act(async () => userEvent.keyboard("{Escape}"));
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(button("Edit project")),
  );
  expect(commands).toEqual([]);

  await act(async () => userEvent.click(button("Edit project")));
  await act(async () =>
    userEvent.fill(container!.querySelector("input")!, "Alpha saved"),
  );
  await act(async () =>
    userEvent.fill(
      container!.querySelector("textarea")!,
      "https://second.test/two\nhttps://third.test/three",
    ),
  );
  const form = container.querySelector("form")!;
  expect(form.getBoundingClientRect().right).toBeLessThanOrEqual(
    container.getBoundingClientRect().right + 1,
  );
  await act(async () => userEvent.click(button("Save")));
  await vi.waitFor(() =>
    expect(commands).toEqual(["rename", "project_update"]),
  );
  expect(snapshot.title).toBe("Alpha saved");
  expect(snapshot.project?.links).toEqual([
    "https://second.test/two",
    "https://third.test/three",
  ]);
  await render();
  expect(
    [...container.querySelectorAll("a")].map((link) => link.textContent),
  ).toEqual(["second.test", "third.test"]);
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(button("Edit project")),
  );
});
