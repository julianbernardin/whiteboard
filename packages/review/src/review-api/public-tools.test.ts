import { afterEach, expect, test } from "vitest";

import type { AuthoringTool } from "./agent-client.js";
import { ReviewApiClient } from "./client.js";
import { createReviewApi } from "./http.js";
import { callPublicTool, publicResult, publicTool } from "./public-tools.js";
import { ReviewStore } from "./store.js";

const stores: ReviewStore[] = [];

afterEach(() => stores.splice(0).forEach((store) => store.close()));

test("public session tools create, edit and retry against the unchanged review store", async () => {
  const store = new ReviewStore(":memory:", {
    validatePins: async () => {},
    validateSource: async () => {},
    validateResource: async () => {},
  });

  stores.push(store);
  const app = createReviewApi(store);

  const client = new ReviewApiClient(
    { serverUrl: "http://test", token: "test" },
    async (url, init) => app.request(url.replace("/reviews-api", ""), init),
  );

  const tools = (await client.read<AuthoringTool[]>("/authoring")).map(
    publicTool,
  );

  const call = (name: string, input: Parameters<typeof callPublicTool>[2]) =>
    callPublicTool(client, tools.find((tool) => tool.name === name)!, input);

  const create = await call("session_create", {
    title: "Public names",
    target: {
      kind: "commits",
      repositoryId: "repo",
      base: "base",
      head: "head",
    },
  });

  expect(create).toHaveProperty("sessionId");
  expect(create).not.toHaveProperty("reviewId");
  const sessionId = store.list()[0].reviewId;

  const literal =
    "Keep reviewId, sessionId and review_create verbatim in authored content.";

  const edit = {
    sessionId,
    edit: { type: "insert", content: { type: "markdown", markdown: literal } },
  };

  await call("session_edit", edit);
  expect(store.read(sessionId).version).toBe(1);
  expect(JSON.stringify(store.read(sessionId).document)).toContain(literal);

  const snapshot = await call("session_get", {
    sessionId,
    format: "json",
    full: true,
  });

  expect(snapshot).toHaveProperty("sessionId", sessionId);
  expect(JSON.stringify(snapshot)).toContain(literal);
  await expect(call("session_get", { reviewId: sessionId })).rejects.toThrow(
    "Use sessionId",
  );
});

test("response translation leaves authored and arbitrary payload fields intact", () => {
  const document = {
    reviewId: "literal",
    review: { reviewId: "also literal" },
  };

  expect(
    publicResult({
      reviewId: "id",
      review: { reviewId: "id", document },
      document,
    }),
  ).toEqual({
    sessionId: "id",
    session: { sessionId: "id", document },
    document,
  });
});

test("Project session tools ensure the default and version named documents", async () => {
  const store = new ReviewStore(":memory:", {
    validatePins: async () => {},
    validateSource: async () => {},
    validateResource: async () => {},
  });
  stores.push(store);
  const opened: string[] = [];
  const app = createReviewApi(store, undefined, async ({ reviewId }) => {
    opened.push(reviewId);
    return { softwareMapEnabled: false };
  });
  const client = new ReviewApiClient(
    { serverUrl: "http://test", token: "test" },
    async (url, init) => app.request(url.replace("/reviews-api", ""), init),
  );
  const tools = (await client.read<AuthoringTool[]>("/authoring")).map(
    publicTool,
  );
  const byName = (name: string) => tools.find((tool) => tool.name === name)!;
  const call = (
    name: string,
    input: Parameters<typeof callPublicTool>[2] = {},
  ) => callPublicTool(client, byName(name), input);

  const createSchema = byName("session_create").inputSchema;
  expect(JSON.stringify(createSchema.properties?.kind)).toContain("project");
  expect(JSON.stringify(createSchema.properties?.kind)).toContain("scratchpad");
  expect(createSchema.properties).toHaveProperty("target");
  expect(createSchema.properties).toHaveProperty("project");
  expect(byName("session_project_update").inputSchema).toMatchObject({
    required: expect.arrayContaining(["sessionId", "links"]),
  });

  expect(await (await app.request("/")).json()).toEqual([]);
  expect(
    await call("session_get", {
      sessionId: "project",
      format: "json",
      full: true,
    }),
  ).toMatchObject({ sessionId: "project", kind: "project" });
  expect(store.read("project").version).toBe(0);
  expect(await call("session_open", { sessionId: "project" })).toMatchObject({
    ok: true,
  });
  expect(opened).toEqual(["project"]);
  const list = await call("session_list");
  expect(list).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sessionId: "project",
        kind: "project",
        project: { links: [] },
      }),
    ]),
  );
  expect(store.read("project").version).toBe(0);
  await call("session_list");
  expect(store.read("project").version).toBe(0);
  const ensured = await call("session_create", {
    kind: "project",
    open: false,
  });
  expect(ensured).toMatchObject({
    sessionId: "project",
    version: 0,
    opened: false,
  });
  expect(
    (
      (await call("session_create", { kind: "project", open: false })) as {
        version: number;
      }
    ).version,
  ).toBe(0);

  const named = (await call("session_create", {
    kind: "project",
    title: "Research",
    open: false,
    project: { links: ["https://one.example", "https://two.example"] },
  })) as { sessionId: string };
  expect(named.sessionId).not.toBe("project");
  const namedId = named.sessionId as string;
  expect(store.read(namedId).project?.links).toEqual([
    "https://one.example",
    "https://two.example",
  ]);
  const review = (await call("session_create", {
    title: "Source review",
    open: false,
    target: {
      kind: "commits",
      repositoryId: "repo",
      base: "base",
      head: "head",
    },
  })) as { sessionId: string };
  await expect(
    call("session_project_update", { sessionId: review.sessionId, links: [] }),
  ).rejects.toThrow();
  await store.ensureScratchpad();
  await expect(
    call("session_project_update", { sessionId: "scratchpad", links: [] }),
  ).rejects.toThrow();
  const before = store.read("project").version;
  await call("session_edit", {
    sessionId: "project",
    edit: {
      type: "insert",
      content: { type: "markdown", markdown: "Project note" },
    },
  });
  expect(store.read("project").version).toBe(before + 1);
  expect(
    await call("session_get", {
      sessionId: "project",
      format: "json",
      full: true,
    }),
  ).toMatchObject({ sessionId: "project", kind: "project" });
  await call("session_project_update", {
    sessionId: "project",
    links: ["https://two.example", "https://one.example"],
  });
  expect(store.read("project").project?.links).toEqual([
    "https://two.example",
    "https://one.example",
  ]);
  await expect(
    call("session_project_update", {
      sessionId: "project",
      links: ["http://invalid.example"],
    }),
  ).rejects.toThrow();
  await call("session_rename", { sessionId: "project", title: "Renamed" });
  expect(store.read("project").title).toBe("Renamed");
  expect(await call("session_history", { sessionId: "project" })).toBeTruthy();
  await call("session_restore", { sessionId: "project", version: 0 });
  expect(store.read("project").project?.links).toEqual([]);
  expect(store.read("project").title).not.toBe("Renamed");
  await expect(
    call("session_project_update", {
      sessionId: "missing",
      links: [],
    }),
  ).rejects.toThrow();
  await expect(call("session_get", { reviewId: "project" })).rejects.toThrow(
    "Use sessionId",
  );
});
