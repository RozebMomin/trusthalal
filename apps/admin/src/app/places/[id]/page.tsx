"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  type HalalClaimAdminRead,
  type PlaceAdminRead,
  type PlaceEventRead,
  type PlaceExternalIdAdminRead,
  type PlaceOwnerAdminRead,
  useAdminHalalClaims,
  useAdminPlaceDetail,
  useAdminPlaceEvents,
  useAdminPlaceExternalIds,
  useAdminPlaceOwners,
  useResyncPlace,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";
import { HalalClaimStatusBadge } from "@/components/halal-claim-status-badge";

import { CreateRequestDialog } from "../../ownership-requests/_components/create-request-dialog";
import { DeletePlaceDialog } from "../_components/delete-place-dialog";
import { PlaceEventBadge } from "../_components/event-badge";
import { LinkGoogleDialog } from "../_components/link-google-dialog";
import { PlaceEditDialog } from "../_components/place-edit-dialog";
import { RestorePlaceDialog } from "../_components/restore-place-dialog";
import { RevokeOwnerDialog } from "../_components/revoke-owner-dialog";
import { UnlinkProviderDialog } from "../_components/unlink-provider-dialog";

function formatTimestamp(iso: string): string {
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
    <div className="grid grid-cols-[160px_1fr] items-start gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

export default function PlaceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const { data: place, isLoading, error } = useAdminPlaceDetail(id);

  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [restoreOpen, setRestoreOpen] = React.useState(false);
  const [linkOpen, setLinkOpen] = React.useState(false);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/places"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← All places
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">
              {isLoading ? <Skeleton className="h-8 w-64" /> : place?.name}
            </h1>
            {place?.is_deleted && (
              <Badge
                variant="destructive"
                title={
                  place.deleted_at
                    ? `Deleted ${formatTimestamp(place.deleted_at)}`
                    : undefined
                }
              >
                Deleted
              </Badge>
            )}
          </div>
          {place?.address && (
            <p className="mt-1 text-muted-foreground">{place.address}</p>
          )}
          {place?.id && (
            <p
              className="mt-1 font-mono text-[11px] text-muted-foreground/70"
              title="Place ID"
            >
              {place.id}
            </p>
          )}
          {place?.updated_at && (
            // Intentionally subtle — the admin is here because they want
            // to look at the place, not its metadata. "Last edited" gives
            // just enough context to judge whether the data is fresh
            // without stealing focus from the actions row.
            <p className="mt-0.5 text-[11px] text-muted-foreground/70">
              Last edited {formatTimestamp(place.updated_at)}
            </p>
          )}
        </div>
        {place && (
          <PlaceActions
            place={place}
            onEdit={() => setEditOpen(true)}
            onDelete={() => setDeleteOpen(true)}
            onRestore={() => setRestoreOpen(true)}
            onLinkGoogle={() => setLinkOpen(true)}
          />
        )}
      </header>

      {error && <ErrorState error={error as Error} />}

      {place && (
        <>
          <section className="rounded-md border p-4">
            <h2 className="mb-2 text-sm font-semibold">Details</h2>
            <dl className="divide-y">
              <Field label="Coordinates">
                <code className="font-mono text-xs">
                  {place.lat.toFixed(6)}, {place.lng.toFixed(6)}
                </code>
              </Field>
            </dl>
          </section>

          <ProviderLinksSection place={place} />
          <OwnershipSection place={place} />
          <HalalClaimsSection placeId={place.id} />
          <EventsSection placeId={place.id} />
        </>
      )}

      {place && (
        <>
          <PlaceEditDialog
            place={place}
            open={editOpen}
            onOpenChange={setEditOpen}
          />
          <DeletePlaceDialog
            place={place}
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
          />
          <RestorePlaceDialog
            place={place}
            open={restoreOpen}
            onOpenChange={setRestoreOpen}
          />
          <LinkGoogleDialog
            place={place}
            open={linkOpen}
            onOpenChange={setLinkOpen}
          />
        </>
      )}
    </div>
  );
}

function PlaceActions({
  place,
  onEdit,
  onDelete,
  onRestore,
  onLinkGoogle,
}: {
  place: PlaceAdminRead;
  onEdit: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onLinkGoogle: () => void;
}) {
  // "Link to Google" is a retroactive operation for places that were
  // added manually before the ingest flow existed. We hide the button
  // when the place already has a canonical_source (almost certainly
  // means there's already a PlaceExternalId link for that provider),
  // and on soft-deleted rows where linking is noisy — admin should
  // restore first and then link if they want to augment the record.
  const showLinkToGoogle = !place.is_deleted && place.canonical_source == null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={onEdit}>
        Edit
      </Button>
      {showLinkToGoogle && (
        <Button size="sm" variant="outline" onClick={onLinkGoogle}>
          Link to Google
        </Button>
      )}
      {place.is_deleted ? (
        <Button size="sm" onClick={onRestore}>
          Restore
        </Button>
      ) : (
        <Button size="sm" variant="destructive" onClick={onDelete}>
          Delete
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Halal claims for this place — read-only summary
// ---------------------------------------------------------------------------
//
// Lists every halal claim filed against this place, newest first,
// with click-through to the per-claim review surface. The admin
// halal-claim API supports a ``place_id`` filter, so we hit the
// canonical queue endpoint with that one parameter — no separate
// per-place collection to maintain.
function HalalClaimsSection({ placeId }: { placeId: string }) {
  const { data, isLoading, error } = useAdminHalalClaims({ placeId });
  return (
    <section className="rounded-md border p-4">
      <h2 className="mb-2 text-sm font-semibold">Halal claims</h2>
      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          Couldn&apos;t load halal claims for this place.
        </p>
      )}
      {!isLoading && !error && data && data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No halal claims filed yet.
        </p>
      )}
      {!isLoading && !error && data && data.length > 0 && (
        <ul className="space-y-2">
          {data.map((claim: HalalClaimAdminRead) => (
            <li
              key={claim.id}
              className="flex items-start justify-between gap-3 rounded-md border bg-card px-3 py-2"
            >
              <div className="min-w-0">
                <Link
                  href={`/halal-claims/${claim.id}`}
                  className="text-sm font-medium hover:underline"
                >
                  {claim.organization?.name ?? "Unknown org"}
                </Link>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {claim.claim_type} · created{" "}
                  {formatTimestamp(claim.created_at)}
                  {claim.submitted_at && (
                    <>
                      {" · submitted "}
                      {formatTimestamp(claim.submitted_at)}
                    </>
                  )}
                </p>
              </div>
              <HalalClaimStatusBadge status={claim.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Provider links (PlaceExternalId)
// ---------------------------------------------------------------------------

/**
 * "What external providers is this place linked to?" — renders the
 * PlaceExternalId rows with last-synced context and per-row Resync /
 * Unlink actions. Empty state points the admin at the "Link to Google"
 * button in the header.
 *
 * Resync toasts name the backfilled fields so admins see what the
 * refresh actually changed instead of a vague "Synced." Unlinking opens
 * a reason-collecting dialog (the reason lands in the event history,
 * same as delete/restore).
 */
function ProviderLinksSection({ place }: { place: PlaceAdminRead }) {
  const { data, isLoading, error } = useAdminPlaceExternalIds(place.id);
  const { toast } = useToast();
  const resync = useResyncPlace();

  // One dialog, reused across rows — capture the "target" before opening.
  const [unlinkTarget, setUnlinkTarget] = React.useState<
    PlaceExternalIdAdminRead | null
  >(null);

  async function onResync() {
    try {
      const result = await resync.mutateAsync({ id: place.id });
      // fields_updated is typed as optional by codegen (Pydantic's
      // default_factory=list is conservative on response shapes) but
      // always arrives as a list on the wire — default to [] defensively.
      const backfilled = result.fields_updated ?? [];
      const body =
        backfilled.length > 0
          ? `Backfilled: ${backfilled.join(", ")}.`
          : "Snapshot refreshed; no canonical fields needed backfill.";
      toast({
        title: "Resynced from Google",
        description: body,
        variant: "success",
      });
    } catch (err) {
      // NO_GOOGLE_LINK shouldn't happen in practice — this handler is
      // attached to a button on a row that only renders when a link
      // exists — but guard it anyway so the toast explains the state
      // instead of leaking the raw server message.
      const msg = friendlyApiError(err, {
        defaultTitle: "Resync failed",
        overrides: {
          NO_GOOGLE_LINK: {
            title: "Nothing to resync",
            description:
              "This place has no Google link. Use 'Link to Google' first, then resync.",
          },
          GOOGLE_PLACE_NOT_FOUND: {
            title: "Google dropped the place",
            description:
              "The linked Google place_id no longer exists upstream. Unlink it and pick a fresh result.",
          },
        },
      });
      toast({ ...msg, variant: "destructive" });
    }
  }

  return (
    <section className="rounded-md border p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Provider links</h2>
        <span className="text-xs text-muted-foreground">
          External IDs backing this place&apos;s canonical data.
        </span>
      </div>

      {isLoading && <Skeleton className="h-16 w-full" />}

      {error && (
        <p className="text-sm text-destructive">
          Couldn&apos;t load provider links: {(error as Error).message}
        </p>
      )}

      {data && data.length === 0 && (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No external providers linked. Use the{" "}
          <span className="font-medium text-foreground">Link to Google</span>{" "}
          button above to attach one.
        </div>
      )}

      {data && data.length > 0 && (
        <ul className="space-y-3">
          {data.map((link) => (
            <ProviderLinkRow
              key={link.id}
              link={link}
              onResync={onResync}
              resyncing={resync.isPending}
              onUnlink={() => setUnlinkTarget(link)}
            />
          ))}
        </ul>
      )}

      {unlinkTarget && (
        <UnlinkProviderDialog
          placeId={place.id}
          placeName={place.name}
          provider={unlinkTarget.provider}
          externalId={unlinkTarget.external_id}
          open={unlinkTarget !== null}
          onOpenChange={(open) => {
            if (!open) setUnlinkTarget(null);
          }}
        />
      )}
    </section>
  );
}

function ProviderLinkRow({
  link,
  onResync,
  resyncing,
  onUnlink,
}: {
  link: PlaceExternalIdAdminRead;
  onResync: () => void;
  resyncing: boolean;
  onUnlink: () => void;
}) {
  const lastSynced = link.last_synced_at
    ? formatTimestamp(link.last_synced_at)
    : "never";
  return (
    <li className="rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="uppercase tracking-wide">
              {link.provider}
            </Badge>
            <code className="truncate font-mono text-xs text-muted-foreground">
              {link.external_id}
            </code>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Last synced {lastSynced}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/*
            Resync only supports Google on the backend today, so the button
            is only meaningful for Google rows. If/when a second provider
            lands, we'll either add a provider-aware resync endpoint or
            gate this button on link.provider === "GOOGLE".
          */}
          <Button
            size="sm"
            variant="outline"
            onClick={onResync}
            disabled={resyncing || link.provider !== "GOOGLE"}
            title={
              link.provider !== "GOOGLE"
                ? "Resync is Google-only for now."
                : undefined
            }
          >
            {resyncing ? "Resyncing…" : "Resync"}
          </Button>
          <Button size="sm" variant="destructive" onClick={onUnlink}>
            Unlink
          </Button>
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

/**
 * "Who owns this place" — organizations linked to the place via the
 * ``place_owners`` join, with role/status context and active member
 * count so the admin can see whether anyone in the org can actually
 * respond if contacted.
 */
function OwnershipSection({ place }: { place: PlaceAdminRead }) {
  const { data, isLoading, error } = useAdminPlaceOwners(place.id);

  // Single dialog reused across rows — capture the row being revoked
  // before opening so the dialog knows which org to name in its copy.
  const [revokeTarget, setRevokeTarget] =
    React.useState<PlaceOwnerAdminRead | null>(null);
  const [createRequestOpen, setCreateRequestOpen] = React.useState(false);

  return (
    <section className="rounded-md border p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Ownership</h2>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCreateRequestOpen(true)}
          >
            Log ownership request
          </Button>
          <Link
            href="/ownership-requests"
            className="text-xs text-muted-foreground hover:underline"
          >
            View ownership requests →
          </Link>
        </div>
      </div>

      <CreateRequestDialog
        open={createRequestOpen}
        onOpenChange={setCreateRequestOpen}
        initialPlace={place}
      />

      {isLoading && <Skeleton className="h-24 w-full" />}

      {error && (
        <p className="text-sm text-destructive">
          Couldn&apos;t load owners: {(error as Error).message}
        </p>
      )}

      {data && data.length === 0 && (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No organizations linked to this place yet. If someone has asked
          to claim it, check{" "}
          <Link
            href="/ownership-requests"
            className="text-primary hover:underline"
          >
            ownership requests
          </Link>
          .
        </div>
      )}

      {data && data.length > 0 && (
        <ul className="space-y-3">
          {data.map((owner) => (
            <OwnerRow
              key={owner.id}
              owner={owner}
              onRevoke={() => setRevokeTarget(owner)}
            />
          ))}
        </ul>
      )}

      {revokeTarget && (
        <RevokeOwnerDialog
          placeId={place.id}
          placeName={place.name}
          ownerId={revokeTarget.id}
          orgName={revokeTarget.organization.name}
          role={revokeTarget.role}
          open={revokeTarget !== null}
          onOpenChange={(open) => {
            if (!open) setRevokeTarget(null);
          }}
        />
      )}
    </section>
  );
}

function OwnerRow({
  owner,
  onRevoke,
}: {
  owner: PlaceOwnerAdminRead;
  onRevoke: () => void;
}) {
  const { organization: org, role, status } = owner;
  // Already-revoked rows are historical audit context — no action to
  // take, so the button would be a no-op. Hide it to keep the row
  // visually simpler.
  const canRevoke = status.toUpperCase() !== "REVOKED";

  return (
    <li className="rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {/*
              Link is live even though /organizations/{id} is still a stub —
              keeps us from having to sweep back here later when the org
              detail page graduates.
            */}
            <Link
              href={`/organizations/${org.id}`}
              className="font-medium hover:underline"
            >
              {org.name}
            </Link>
            <OwnerRoleBadge role={role} />
            <OwnerStatusBadge status={status} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {org.contact_email ? (
              <a
                href={`mailto:${org.contact_email}`}
                className="hover:underline"
              >
                {org.contact_email}
              </a>
            ) : (
              <span className="italic">no contact email</span>
            )}
            {" · "}
            {org.member_count} active{" "}
            {org.member_count === 1 ? "member" : "members"}
            {" · linked "}
            {formatTimestamp(owner.created_at)}
          </div>
        </div>
        {canRevoke && (
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="destructive" onClick={onRevoke}>
              Revoke
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

// Role / status are free-form strings on the backend (so we can evolve
// them without a migration), but the admin UI only knows a small set of
// well-known values today. Unknown values render as a neutral badge so
// future server-side additions show up instead of disappearing.
function OwnerRoleBadge({ role }: { role: string }) {
  const normalized = role.toUpperCase();
  const variant =
    normalized === "PRIMARY" ? "default" : ("secondary" as const);
  return (
    <Badge variant={variant} className="uppercase tracking-wide">
      {role}
    </Badge>
  );
}

function OwnerStatusBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase();
  // ACTIVE / VERIFIED are "good" states; PENDING is in-flight; everything
  // else gets the destructive variant so surprises don't blend in.
  let variant: "default" | "secondary" | "destructive" = "destructive";
  if (normalized === "ACTIVE" || normalized === "VERIFIED") variant = "default";
  else if (normalized === "PENDING") variant = "secondary";
  return (
    <Badge variant={variant} className="uppercase tracking-wide">
      {status}
    </Badge>
  );
}

function EventsSection({ placeId }: { placeId: string }) {
  const { data, isLoading, error } = useAdminPlaceEvents(placeId);

  return (
    <section className="rounded-md border p-4">
      <h2 className="mb-3 text-sm font-semibold">Event history</h2>
      {isLoading && <Skeleton className="h-16 w-full" />}
      {error && (
        <p className="text-sm text-destructive">
          Couldn&apos;t load events: {(error as Error).message}
        </p>
      )}
      {data && data.length === 0 && (
        <p className="text-sm text-muted-foreground">No events recorded.</p>
      )}
      {data && data.length > 0 && (
        <ol className="space-y-2 border-l pl-4">
          {data.map((ev: PlaceEventRead) => (
            <li key={ev.id} className="relative text-sm">
              <span className="absolute -left-[21px] top-2 h-2 w-2 rounded-full bg-muted-foreground" />
              <div className="flex flex-wrap items-center gap-2">
                <PlaceEventBadge eventType={ev.event_type} />
                <span className="text-xs text-muted-foreground">
                  {formatTimestamp(ev.created_at)}
                </span>
              </div>
              {ev.message && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {ev.message}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ErrorState({ error }: { error: Error }) {
  const isApi = error instanceof ApiError;
  return (
    <div
      role="alert"
      className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
    >
      <p className="font-medium">
        Failed to load place
        {isApi && ` (HTTP ${error.status})`}
      </p>
      <p>{error.message}</p>
    </div>
  );
}
