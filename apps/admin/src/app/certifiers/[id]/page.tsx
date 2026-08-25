"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  type CertifierAdverseEventTypeValue,
  useAddCertifierAdverseEvent,
  useAddCertifierAlias,
  useAdminCertifier,
  useRemoveCertifierAlias,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

import { EditCertifierDialog } from "./_components/edit-certifier-dialog";

const EVENT_TYPES: CertifierAdverseEventTypeValue[] = [
  "CONVICTION",
  "SANCTION",
  "DELISTING",
  "DISPUTE",
  "OTHER",
];
const EVENT_LABEL: Record<CertifierAdverseEventTypeValue, string> = {
  CONVICTION: "Conviction",
  SANCTION: "Sanction",
  DELISTING: "Delisting",
  DISPUTE: "Dispute",
  OTHER: "Other",
};

function fmt(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function CertifierDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { toast } = useToast();

  const { data: cert, isLoading } = useAdminCertifier(id);
  const addAlias = useAddCertifierAlias(id ?? "");
  const removeAlias = useRemoveCertifierAlias(id ?? "");
  const addEvent = useAddCertifierAdverseEvent(id ?? "");

  const [editOpen, setEditOpen] = React.useState(false);
  const [newAlias, setNewAlias] = React.useState("");

  const [evType, setEvType] = React.useState<CertifierAdverseEventTypeValue>("DISPUTE");
  const [evSummary, setEvSummary] = React.useState("");
  const [evDate, setEvDate] = React.useState("");
  const [evUrl, setEvUrl] = React.useState("");

  if (isLoading || !cert) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  async function onAddAlias(e: React.FormEvent) {
    e.preventDefault();
    const value = newAlias.trim();
    if (!value || addAlias.isPending) return;
    try {
      await addAlias.mutateAsync(value);
      setNewAlias("");
      toast({ title: "Alias added", variant: "success" });
    } catch (err) {
      toast({ ...friendlyApiError(err, { defaultTitle: "Couldn't add alias" }), variant: "destructive" });
    }
  }

  async function onRemoveAlias(aliasId: string, alias: string) {
    if (!window.confirm(`Remove the alias "${alias}"?`)) return;
    try {
      await removeAlias.mutateAsync(aliasId);
      toast({ title: "Alias removed", variant: "success" });
    } catch (err) {
      toast({ ...friendlyApiError(err, { defaultTitle: "Couldn't remove alias" }), variant: "destructive" });
    }
  }

  async function onAddEvent(e: React.FormEvent) {
    e.preventDefault();
    const summary = evSummary.trim();
    if (!summary || addEvent.isPending) return;
    try {
      await addEvent.mutateAsync({
        event_type: evType,
        summary,
        occurred_on: evDate || null,
        source_url: evUrl.trim() || null,
      });
      setEvSummary(""); setEvDate(""); setEvUrl(""); setEvType("DISPUTE");
      toast({ title: "Adverse event recorded", variant: "success" });
    } catch (err) {
      toast({ ...friendlyApiError(err, { defaultTitle: "Couldn't record event" }), variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/certifiers" className="text-sm text-muted-foreground hover:underline">
          ← Certifiers
        </Link>
      </div>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-bold tracking-tight">{cert.name}</h1>
          <p className="font-mono text-xs text-muted-foreground">{cert.slug}</p>
          <p className="text-sm text-muted-foreground">
            {[cert.legal_entity, cert.country_code].filter(Boolean).join(" · ") || "—"}
          </p>
          {cert.website && (
            <a
              href={cert.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary underline-offset-2 hover:underline"
            >
              {cert.website}
            </a>
          )}
          {cert.notes && (
            <p className="max-w-2xl text-sm text-muted-foreground">{cert.notes}</p>
          )}
        </div>
        <Button variant="outline" onClick={() => setEditOpen(true)}>
          Edit
        </Button>
      </header>

      <EditCertifierDialog certifier={cert} open={editOpen} onOpenChange={setEditOpen} />

      {/* Aliases */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Aliases</h2>
        <p className="text-sm text-muted-foreground">
          Acronyms and alternate spellings that resolve to this body. This is
          what turns a typed &ldquo;{cert.aliases[0]?.alias ?? "HTO"}&rdquo; into
          &ldquo;{cert.name}&rdquo;.
        </p>
        <div className="flex flex-wrap gap-2">
          {cert.aliases.length === 0 ? (
            <span className="text-sm text-muted-foreground">No aliases yet.</span>
          ) : (
            cert.aliases.map((a) => (
              <span
                key={a.id}
                className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-sm"
              >
                {a.alias}
                <button
                  type="button"
                  onClick={() => onRemoveAlias(a.id, a.alias)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Remove alias ${a.alias}`}
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>
        <form onSubmit={onAddAlias} className="flex max-w-sm gap-2">
          <Input
            value={newAlias}
            onChange={(e) => setNewAlias(e.target.value)}
            placeholder="Add an alias (e.g. HTO)"
          />
          <Button type="submit" disabled={!newAlias.trim() || addAlias.isPending}>
            Add
          </Button>
        </form>
      </section>

      {/* Adverse events (admin-only context) */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Adverse events</h2>
        <p className="text-sm text-muted-foreground">
          Admin-only context for curation — convictions, sanctions, disputes.
          Never surfaced to consumers.
        </p>
        <div className="space-y-2">
          {cert.adverse_events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing recorded.</p>
          ) : (
            cert.adverse_events.map((ev) => (
              <div key={ev.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                    {EVENT_LABEL[ev.event_type]}
                  </span>
                  <span className="text-xs text-muted-foreground">{fmt(ev.occurred_on)}</span>
                </div>
                <p className="mt-1.5 text-sm">{ev.summary}</p>
                {ev.source_url && (
                  <a
                    href={ev.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-xs text-primary underline-offset-2 hover:underline"
                  >
                    Source
                  </a>
                )}
              </div>
            ))
          )}
        </div>

        <form onSubmit={onAddEvent} className="space-y-3 rounded-md border p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={evType} onValueChange={(v) => setEvType(v as CertifierAdverseEventTypeValue)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {EVENT_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-date">Occurred on</Label>
              <Input
                id="ev-date"
                type="date"
                value={evDate}
                onChange={(e) => setEvDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ev-summary">Summary</Label>
            <Textarea
              id="ev-summary"
              value={evSummary}
              onChange={(e) => setEvSummary(e.target.value)}
              rows={2}
              placeholder="What happened, in one or two sentences."
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ev-url">Source URL</Label>
            <Input
              id="ev-url"
              value={evUrl}
              onChange={(e) => setEvUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={!evSummary.trim() || addEvent.isPending}>
              {addEvent.isPending ? "Saving…" : "Record event"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
