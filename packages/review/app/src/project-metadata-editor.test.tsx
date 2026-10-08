// @vitest-environment jsdom
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createReviewApi } from "@review/review-api/http";
import { ReviewStore } from "@review/review-api/store";
import { Hono } from "hono";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ReviewSessionProvider } from "./host/review-session";
import { ProjectMetadataEditor } from "./project-metadata-editor";
import { testReviewSession } from "./review-session-test-utils";

let directory: string;
let store: ReviewStore;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  directory = mkdtempSync(path.join(tmpdir(), "project-metadata-editor-"));
  store = new ReviewStore(path.join(directory, "review.db"), {
    validatePins: async () => {},
    validateSource: async () => {},
    validateResource: async () => {},
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await store.close();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

const button = (text: string) =>
  [...container.querySelectorAll("button")].find(
    (item) => item.textContent === text,
  )!;

async function change(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    const prototype =
      element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      element,
      value,
    );
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function render(
  reviewId: string,
  options: {
    historical?: boolean;
    shared?: boolean;
    failLinks?: boolean;
    beforeRead?: () => Promise<void>;
  } = {},
) {
  const app = new Hono().route("/reviews-api", createReviewApi(store));
  const requests: string[] = [];
  const session = testReviewSession(
    {},
    {
      request: async (url, init) => {
        if (String(url).includes("?full=true")) await options.beforeRead?.();
        if (init?.method === "POST") {
          const operation = JSON.parse(String(init.body)).operation;
          requests.push(operation.type);
          if (options.failLinks && operation.type === "project_update")
            return Response.json(
              { error: "Links unavailable" },
              { status: 500 },
            );
        }
        return app.request(url, init);
      },
    },
  );
  if (options.historical) session.review!.historicalRevision = "1";
  const snapshot = store.read(reviewId);
  if (options.shared) snapshot.shared = { login: "someone" };
  await act(async () =>
    root.render(
      <ReviewSessionProvider session={session}>
        <ProjectMetadataEditor snapshot={snapshot} />
      </ReviewSessionProvider>,
    ),
  );
  return requests;
}

it("keeps the draft closed to a second edit during editing and saving, then restores focus", async () => {
  const project = await store.execute({
    operation: {
      type: "create",
      kind: "project",
      title: "Alpha",
      project: { links: ["https://first.test"] },
    },
  });
  let releaseRead!: () => void;
  const pendingRead = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const requests = await render(project.reviewId, {
    beforeRead: () => pendingRead,
  });
  const originalTrigger = button("Edit project");
  await act(async () => originalTrigger.click());
  await change(container.querySelector("input")!, "Draft title");
  await change(container.querySelector("textarea")!, "https://draft.test");
  expect(button("Edit project")).toBeUndefined();
  await act(async () => originalTrigger.click());
  expect(container.querySelector("input")!.value).toBe("Draft title");
  expect(container.querySelector("textarea")!.value).toBe("https://draft.test");

  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(container.textContent).toContain("Saving");
  expect(button("Edit project")).toBeUndefined();
  await act(async () => originalTrigger.click());
  expect(requests).toEqual([]);
  expect(container.querySelector("input")!.value).toBe("Draft title");

  await act(async () => releaseRead());
  await vi.waitFor(() =>
    expect(requests).toEqual(["rename", "project_update"]),
  );
  await vi.waitFor(() => expect(container.querySelector("form")).toBeNull());
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(button("Edit project")),
  );
  await render(project.reviewId);
  await act(async () => button("Edit project").click());
  expect(container.querySelector("input")!.value).toBe("Draft title");
  await act(async () => button("Cancel").click());
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(button("Edit project")),
  );
});

it("shows named/default links securely, guards read-only, and preserves versions on cancel, Escape, invalid input and no-op", async () => {
  await store.ensureDefaultProject();
  const named = await store.execute({
    operation: {
      type: "create",
      kind: "project",
      title: "Alpha",
      project: { links: ["https://example.org/one"] },
    },
  });
  const requests = await render(named.reviewId);
  const link = container.querySelector("a")!;
  expect(link.textContent).toBe("example.org");
  expect(link.title).toBe("https://example.org/one");
  expect(link.target).toBe("_blank");
  expect(link.rel).toBe("noopener noreferrer");
  await act(async () => button("Edit project").click());
  const title = container.querySelector("input")!;
  const links = container.querySelector("textarea")!;
  expect(title.value).toBe("Alpha");
  expect(links.value).toBe("https://example.org/one");
  expect(document.activeElement).toBe(title);
  await act(async () => button("Cancel").click());
  await act(async () => button("Edit project").click());
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
  );
  expect(container.querySelector("form")).toBeNull();
  await act(async () => button("Edit project").click());
  await change(container.querySelector("input")!, "  ");
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(container.textContent).toContain("Title is required");
  await change(container.querySelector("input")!, "Alpha");
  await change(container.querySelector("textarea")!, "http://insecure.test");
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(container.textContent).toContain("valid HTTPS URL");
  await change(container.querySelector("textarea")!, "https://example.org/one");
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(requests).toEqual([]);
  expect(store.history(named.reviewId)).toHaveLength(1);

  await render("project");
  expect(button("Edit project")).toBeTruthy();
  await render(named.reviewId, { historical: true });
  expect(container.querySelector("button")).toBeNull();
  await render(named.reviewId, { shared: true });
  expect(container.querySelector("button")).toBeNull();
});

it("saves only changed commands, preserves order, and detects remote metadata conflicts", async () => {
  const project = await store.execute({
    operation: {
      type: "create",
      kind: "project",
      title: "Alpha",
      project: { links: ["https://first.test", "https://second.test"] },
    },
  });
  const requests = await render(project.reviewId);
  await act(async () => button("Edit project").click());
  await change(container.querySelector("input")!, "Alpha renamed");
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(requests).toEqual(["rename"]);
  expect(store.read(project.reviewId).version).toBe(project.version + 1);
  await render(project.reviewId);
  await act(async () => button("Edit project").click());
  await change(
    container.querySelector("textarea")!,
    "https://new.test\nhttps://second.test\nhttps://third.test",
  );
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(store.read(project.reviewId).project?.links).toEqual([
    "https://new.test",
    "https://second.test",
    "https://third.test",
  ]);
  expect(store.read(project.reviewId).version).toBe(project.version + 2);
  await render(project.reviewId);
  await act(async () => button("Edit project").click());
  await change(container.querySelector("input")!, "Draft title");
  await store.execute({
    operation: {
      type: "project_update",
      reviewId: project.reviewId,
      links: ["https://remote.test"],
    },
  });
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(container.textContent).toContain("changed elsewhere");
  expect(button("Reload latest")).toBeTruthy();
  expect(store.read(project.reviewId).title).toBe("Alpha renamed");
  await act(async () => button("Reload latest").click());
  expect(container.querySelector("textarea")!.value).toBe(
    "https://remote.test",
  );
});

it("reports a partial save and keeps pending links after rename succeeds", async () => {
  const project = await store.execute({
    operation: { type: "create", kind: "project", title: "Alpha" },
  });
  const requests = await render(project.reviewId, { failLinks: true });
  await act(async () => button("Edit project").click());
  await change(container.querySelector("input")!, "New title");
  await change(container.querySelector("textarea")!, "https://pending.test");
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(requests).toEqual(["rename", "project_update"]);
  expect(container.textContent).toContain(
    "Title saved; links are still pending",
  );
  expect(container.querySelector("textarea")!.value).toBe(
    "https://pending.test",
  );
  expect(store.read(project.reviewId)).toMatchObject({
    title: "New title",
    version: project.version + 1,
    project: { links: [] },
  });
});

it("runs one sequential two-command save despite duplicate submits and retains restorable metadata", async () => {
  const project = await store.execute({
    operation: {
      type: "create",
      kind: "project",
      title: "Alpha",
      project: { links: ["https://old.test"] },
    },
  });
  const before = store.read(project.reviewId);
  const requests = await render(project.reviewId);
  await act(async () => button("Edit project").click());
  await change(container.querySelector("input")!, "  Beta  ");
  await change(
    container.querySelector("textarea")!,
    " https://new.test/a \n\nhttps://new.test/b\n",
  );
  await act(async () => {
    const form = container.querySelector("form")!;
    form.requestSubmit();
    form.requestSubmit();
  });
  expect(requests).toEqual(["rename", "project_update"]);
  expect(store.read(project.reviewId)).toMatchObject({
    title: "Beta",
    version: before.version + 2,
    project: { links: ["https://new.test/a", "https://new.test/b"] },
    document: before.document,
  });
  expect(store.history(project.reviewId)).toHaveLength(3);
  await store.execute({
    operation: {
      type: "restore",
      reviewId: project.reviewId,
      version: before.version,
    },
  });
  expect(store.read(project.reviewId)).toMatchObject({
    title: "Alpha",
    project: { links: ["https://old.test"] },
  });
});
