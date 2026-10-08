import { ReviewApiClient } from "@review/review-api/client";
import type { Snapshot } from "@review/review-api/store";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import { useReviewSession } from "./host/review-session";

type Metadata = { title: string; links: string[] };

function metadata(snapshot: Snapshot): Metadata {
  return { title: snapshot.title, links: [...(snapshot.project?.links ?? [])] };
}

function sameLinks(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length && left.every((link, i) => link === right[i])
  );
}

function sameMetadata(left: Metadata, right: Metadata) {
  return left.title === right.title && sameLinks(left.links, right.links);
}

function errorText(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Project metadata is independent of any Markdown H1 in the document. */
export function ProjectMetadataEditor({ snapshot }: { snapshot: Snapshot }) {
  const session = useReviewSession();
  const client = useMemo(
    () => new ReviewApiClient(session.bridge.config, session.bridge.request),
    [session.bridge],
  );
  const [opened, setOpened] = useState<Metadata | null>(null);
  const [title, setTitle] = useState("");
  const [linksText, setLinksText] = useState("");
  const [fieldError, setFieldError] = useState<"title" | "links" | null>(null);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState<Metadata | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const titleErrorId = useId();
  const linksErrorId = useId();
  const statusId = useId();
  const editable =
    snapshot.kind === "project" &&
    !snapshot.shared &&
    session.review?.historicalRevision == null;

  useEffect(() => {
    if (opened) titleRef.current?.focus();
  }, [opened !== null]);

  const close = () => {
    if (savingRef.current) return;
    setOpened(null);
    setConflict(null);
    setMessage("");
    setFieldError(null);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const open = () => {
    const current = metadata(snapshot);
    setOpened(current);
    setTitle(current.title);
    setLinksText(current.links.join("\n"));
    setFieldError(null);
    setMessage("");
    setConflict(null);
  };

  const reload = () => {
    if (!conflict) return;
    setOpened(conflict);
    setTitle(conflict.title);
    setLinksText(conflict.links.join("\n"));
    setConflict(null);
    setFieldError(null);
    setMessage("");
    titleRef.current?.focus();
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editable || !opened || savingRef.current || conflict) return;

    const nextTitle = title.trim();
    const nextLinks = linksText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!nextTitle) {
      setFieldError("title");
      setMessage("Title is required.");
      titleRef.current?.focus();
      return;
    }
    for (const link of nextLinks) {
      try {
        const url = new URL(link);
        if (
          url.protocol !== "https:" ||
          !url.hostname ||
          url.username ||
          url.password
        )
          throw new Error("Invalid HTTPS URL");
      } catch {
        setFieldError("links");
        setMessage(`Enter a valid HTTPS URL on each line. Invalid: ${link}`);
        return;
      }
    }

    setFieldError(null);
    setMessage("");
    const next = { title: nextTitle, links: nextLinks };
    if (sameMetadata(opened, next)) {
      close();
      return;
    }

    savingRef.current = true;
    setSaving(true);
    let renamed = false;
    try {
      const latest = await client.read<Snapshot>(
        `/${encodeURIComponent(snapshot.reviewId)}?full=true`,
      );
      const current = metadata(latest);
      if (!sameMetadata(opened, current)) {
        setConflict(current);
        setMessage(
          "Project title or links changed elsewhere. Reload to review the latest values, or cancel.",
        );
        return;
      }

      // These are separate versioned commands. A later failure cannot undo rename.
      if (next.title !== opened.title) {
        await client.post("/commands", {
          operation: {
            type: "rename",
            reviewId: snapshot.reviewId,
            title: next.title,
          },
        });
        renamed = true;
      }
      if (!sameLinks(next.links, opened.links)) {
        await client.post("/commands", {
          operation: {
            type: "project_update",
            reviewId: snapshot.reviewId,
            links: next.links,
          },
        });
      }
      // The live follow stream remains authoritative for the displayed metadata.
      setOpened(null);
      setMessage("");
      requestAnimationFrame(() => triggerRef.current?.focus());
    } catch (cause) {
      if (renamed) {
        try {
          const latest = await client.read<Snapshot>(
            `/${encodeURIComponent(snapshot.reviewId)}?full=true`,
          );
          setOpened(metadata(latest));
        } catch {
          // Keep the original draft when refresh is unavailable.
        }
        setMessage(`Title saved; links are still pending. ${errorText(cause)}`);
      } else {
        setMessage(`Project was not saved. ${errorText(cause)}`);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape" && !savingRef.current) {
      event.preventDefault();
      close();
    }
  };

  return (
    <section
      aria-label="Project metadata"
      style={{ marginBlock: "0.75rem 1rem", maxWidth: "min(100%, 42rem)" }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          alignItems: "center",
        }}
      >
        {editable && (
          <button
            ref={triggerRef}
            type="button"
            onClick={open}
            aria-expanded={opened !== null}
          >
            Edit project
          </button>
        )}
        {snapshot.project?.links.map((link, index) => (
          <a
            key={`${index}:${link}`}
            href={link}
            title={link}
            aria-label={link}
            target="_blank"
            rel="noopener noreferrer"
            style={{ overflowWrap: "anywhere" }}
          >
            {new URL(link).hostname}
          </a>
        ))}
      </div>
      {opened && editable && (
        <form
          onSubmit={save}
          onKeyDown={onKeyDown}
          aria-label="Edit project metadata"
          style={{
            display: "grid",
            gap: "0.75rem",
            marginTop: "0.75rem",
            maxWidth: "100%",
          }}
        >
          <label htmlFor={`${titleErrorId}-input`}>Title</label>
          <input
            ref={titleRef}
            id={`${titleErrorId}-input`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-invalid={fieldError === "title"}
            aria-describedby={fieldError === "title" ? titleErrorId : undefined}
            disabled={saving}
            style={{ minWidth: 0, width: "100%", boxSizing: "border-box" }}
          />
          <label htmlFor={`${linksErrorId}-input`}>
            Links (one HTTPS URL per line)
          </label>
          <textarea
            id={`${linksErrorId}-input`}
            value={linksText}
            onChange={(event) => setLinksText(event.target.value)}
            rows={4}
            aria-invalid={fieldError === "links"}
            aria-describedby={fieldError === "links" ? linksErrorId : undefined}
            disabled={saving}
            style={{ minWidth: 0, width: "100%", boxSizing: "border-box" }}
          />
          {message && (
            <p
              id={
                fieldError === "title"
                  ? titleErrorId
                  : fieldError === "links"
                    ? linksErrorId
                    : statusId
              }
              role="alert"
            >
              {message}
            </p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {conflict ? (
              <button type="button" onClick={reload}>
                Reload latest
              </button>
            ) : (
              <button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            )}
            <button type="button" onClick={close} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
