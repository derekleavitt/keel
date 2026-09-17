'use client';

import { ALLOWED_CONTENT_TYPES } from '@keel/contracts/attachment';
import { deleteAttachmentAction, uploadAttachmentAction } from '@keel/testbed-attachments/actions';
import { useSerialMutations } from '@keel/ui';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

type Attachment = { id: string; filename: string; size: number };

const readable = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function Attachments({
  todoId,
  todoTitle,
  files,
  canEdit,
}: {
  todoId: string;
  todoTitle: string;
  files: Attachment[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { enqueue, pending } = useSerialMutations({
    onSettled: () => router.refresh(),
    onError: setError,
  });

  if (files.length === 0 && !canEdit) return null;

  return (
    <div className="flex flex-col gap-2">
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs"
            >
              {/*
               * A route, not a static URL: authorization runs per request, so revoking a
               * share revokes the download too.
               */}
              <a href={`/api/attachments/${file.id}`} className="underline underline-offset-4">
                {file.filename}
              </a>
              <span className="text-muted">{readable(file.size)}</span>
              {canEdit && (
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`Remove ${file.filename}`}
                  className="text-muted"
                  onClick={() => {
                    setError(null);
                    enqueue(() => deleteAttachmentAction(file.id));
                  }}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form
          action={(data) => {
            setError(null);
            data.set('todoId', todoId);
            enqueue(() => uploadAttachmentAction(data));
            inputRef.current?.form?.reset();
          }}
        >
          <input
            ref={inputRef}
            type="file"
            name="file"
            aria-label={`Attach a file to ${todoTitle}`}
            accept={ALLOWED_CONTENT_TYPES.join(',')}
            disabled={pending}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
            className="text-xs text-muted file:mr-2 file:rounded file:border file:border-line file:bg-surface-2 file:px-2 file:py-1 file:text-xs"
          />
        </form>
      )}

      {error && (
        <p role="alert" className="text-xs text-muted">
          {error}
        </p>
      )}
    </div>
  );
}
