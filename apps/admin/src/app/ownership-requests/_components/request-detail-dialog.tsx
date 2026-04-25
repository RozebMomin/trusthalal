"use client";

import Link from "next/link";
import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type OwnershipRequestAdminRead } from "@/lib/api/hooks";

import { StatusBadge } from "./status-badge";

type Props = {
  request: OwnershipRequestAdminRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function formatTimestamp(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

export function RequestDetailDialog({ request, open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span>Ownership request</span>
            <StatusBadge status={request.status} />
          </DialogTitle>
          <DialogDescription>
            Submitted {formatTimestamp(request.created_at)}
          </DialogDescription>
        </DialogHeader>

        <dl className="mt-2 divide-y">
          <Field label="Contact name">{request.contact_name}</Field>
          <Field label="Contact email">
            <a
              href={`mailto:${request.contact_email}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              {request.contact_email}
            </a>
          </Field>
          <Field label="Contact phone">
            {request.contact_phone ?? (
              <span className="text-muted-foreground">&mdash;</span>
            )}
          </Field>
          <Field label="Message">
            {request.message ? (
              <p className="whitespace-pre-wrap">{request.message}</p>
            ) : (
              <span className="text-muted-foreground">&mdash;</span>
            )}
          </Field>
          <Field label="Place id">
            <Link
              href={`/places/${request.place_id}`}
              className="font-mono text-xs text-primary hover:underline"
            >
              {request.place_id}
            </Link>
          </Field>
          <Field label="Requester user id">
            {request.requester_user_id ? (
              <code className="font-mono text-xs">
                {request.requester_user_id}
              </code>
            ) : (
              <span className="text-muted-foreground">
                anonymous submission
              </span>
            )}
          </Field>
          <Field label="Last updated">
            {formatTimestamp(request.updated_at)}
          </Field>
        </dl>
      </DialogContent>
    </Dialog>
  );
}
