"use client";

/**
 * Append-only admin note log for a verification visit. Any admin can jot an
 * internal note ("called the restaurant", "waiting on a cert", "looks like a
 * duplicate of X"); each is stamped with the author and time. Distinct from
 * the verifier's own note and the accept/reject decision note.
 */
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import { useAddVisitNote, useVisitNotes } from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function VisitNotesSection({ visitId }: { visitId: string }) {
  const { data, isLoading, error } = useVisitNotes(visitId);
  const add = useAddVisitNote(visitId);
  const { toast } = useToast();
  const [body, setBody] = React.useState("");

  async function onAdd() {
    const text = body.trim();
    if (!text || add.isPending) return;
    try {
      await add.mutateAsync(text);
      setBody("");
    } catch (err) {
      toast({
        ...friendlyApiError(err, { defaultTitle: "Couldn't add the note" }),
        variant: "destructive",
      });
    }
  }

  return (
    <section className="rounded-md border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">
        Admin notes{" "}
        {data && (
          <span className="font-normal text-muted-foreground">
            ({data.length})
          </span>
        )}
      </h3>

      <div className="space-y-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          maxLength={4000}
          placeholder="Log something about this visit — e.g. called the restaurant, waiting on a cert, looks like a duplicate…"
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => void onAdd()}
            disabled={!body.trim() || add.isPending}
          >
            {add.isPending ? "Adding…" : "Add note"}
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {isLoading && <Skeleton className="h-16 w-full" />}
        {error && (
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load notes.
          </p>
        )}
        {!isLoading && !error && data && data.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No notes yet. Add the first one above.
          </p>
        )}
        {data?.map((n) => (
          <div key={n.id} className="rounded-md border bg-background p-3">
            <p className="whitespace-pre-wrap text-sm">{n.body}</p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {n.author_name || n.author_email || "Unknown"} ·{" "}
              {formatWhen(n.created_at)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
