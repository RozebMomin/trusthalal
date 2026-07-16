"use client";

/**
 * Shared drag-drop / browse file picker for the `/get-verified`
 * wizard. Mirrors the validation constants and staging behaviour of
 * the existing org-detail + claim pages (PDF/JPEG/PNG/HEIC, 10 MB
 * cap) so the parallel flow enforces the same client-side gates
 * before the server re-validates.
 *
 * The parent owns the `files` array; this component only surfaces the
 * drop zone, the per-file remove rows, and a validation error. Same
 * contract the existing `FilePicker` in /claim uses.
 */

import { FileText, UploadCloud, X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

// Mirror of the server allow-list — identical to the set used by the
// existing org / claim / halal-claim upload UIs.
export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
]);
export const ALLOWED_HUMAN = "PDF, JPEG, PNG, HEIC";
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const FILE_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Validate + append incoming files against the shared constraints,
 * returning the next array plus an optional error string. Dedupes by
 * (name, size). `existingCount` lets callers count already-uploaded
 * server-side attachments toward the cap.
 */
export function stageFiles({
  incoming,
  current,
  maxFiles,
  existingCount = 0,
}: {
  incoming: FileList | File[];
  current: File[];
  maxFiles: number;
  existingCount?: number;
}): { files: File[]; error: string | null } {
  const next = [...current];
  let error: string | null = null;

  for (const file of Array.from(incoming)) {
    if (existingCount + next.length >= maxFiles) {
      error = `You can attach at most ${maxFiles} file${
        maxFiles === 1 ? "" : "s"
      }.`;
      break;
    }
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      error = `${file.name}: file type not supported. Allowed: ${ALLOWED_HUMAN}.`;
      continue;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      error = `${file.name}: file is larger than ${
        MAX_FILE_SIZE_BYTES / 1024 / 1024
      } MB.`;
      continue;
    }
    if (next.some((n) => n.name === file.name && n.size === file.size)) {
      continue;
    }
    next.push(file);
  }

  return { files: next, error };
}

export function FileDrop({
  files,
  onAdd,
  onRemove,
  disabled = false,
  error,
  maxFiles,
  multiple = true,
  prompt,
  hint,
}: {
  files: File[];
  onAdd: (incoming: FileList | File[]) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
  error?: string | null;
  maxFiles: number;
  multiple?: boolean;
  prompt?: string;
  hint?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = React.useState(false);

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onAdd(e.dataTransfer.files);
    }
  }

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={onDrop}
        className={cn(
          "rounded-xl border border-dashed bg-background px-4 py-7 text-center transition",
          isDragOver ? "border-primary bg-primary/5" : "border-input",
          disabled && "opacity-60",
        )}
      >
        <UploadCloud
          className="mx-auto mb-2 h-6 w-6 text-muted-foreground"
          aria-hidden
        />
        <p className="text-sm text-muted-foreground">
          {prompt ?? "Drop files here, or "}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
            className="font-semibold text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed"
          >
            browse
          </button>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {hint ??
            `${ALLOWED_HUMAN} · up to ${
              MAX_FILE_SIZE_BYTES / 1024 / 1024
            } MB each · max ${maxFiles} files`}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple={multiple}
          accept={FILE_ACCEPT}
          className="hidden"
          disabled={disabled}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onAdd(e.target.files);
            }
            e.target.value = "";
          }}
        />
      </div>

      {error && (
        <p role="alert" aria-live="polite" className="text-xs text-destructive">
          {error}
        </p>
      )}

      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${file.size}-${i}`}
              className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2 text-sm"
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(file.size)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(i)}
                disabled={disabled}
                aria-label={`Remove ${file.name}`}
                className="shrink-0 text-muted-foreground transition hover:text-foreground disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
