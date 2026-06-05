# Documenso Fork Patches — Re-application Guide (v2.11.0)

This document captures all fork-local patches applied to our Documenso installation. Apply these in order on any fresh Documenso v2.11.0 install to reproduce the same signer behavior.

**Target version:** Documenso v2.11.0
**Package manager:** npm (this fork diverges from upstream pnpm)
**Runtime:** Node v22.x via nvm

---

## Goal of these patches

Three groups of fork-local changes:

1. **Signer behavior (Patches 1–3, 8).** Force signers to **manually type their initials** for every
   Initials field — no auto-fill from the signer's name, no bulk auto-sign dialog. Compliance /
   signer-intent requirement: auto-typed initials don't satisfy our "actively initialed each field"
   standard. Patch 8 adds a client-side double-submit guard to that flow.
2. **Rendering (Patches 4, 9–10).** Fix Initials field rendering on scaled-down/mobile PDFs
   (Patch 4), re-establish the container-query context lost through the portal (Patch 9), and make
   placeholder/value font sizing responsive so values fit small mobile fields without clipping
   (Patch 10).
3. **Operations & reliability (Patches 5–7).** Improve observability — readable timestamps +
   daily-rotated, level-configurable logs (Patch 5) and timestamped PM2 logs (Patch 6) — and make
   `signFieldWithToken` idempotent so client retries on already-inserted fields no longer 5xx (Patch 7).

Patches are mostly independent and can be applied à la carte, with these dependencies:
- Patch 4c adds a `textAlign` prop to the initials placeholder edited in Patch 2 — apply Patch 2
  first, and Patch 4b (which adds that prop to `DocumentSigningFieldsUninserted`).
- Patch 8 layers edits onto the Patch 2 file — apply Patch 2 first.
- Patch 9 edits the same className string as Patch 4a.
- Patch 10 edits the same classNames as Patch 4b, and its `cqw` sizing depends on Patch 9's
  `[container-type:inline-size]` to resolve correctly.
- Patch 7 (server) and Patch 8 (client) are complementary guards against double-submit; apply both.

---

## Pre-flight

```bash
# Confirm version
cat /path/to/documenso/package.json | grep '"version"'
# Should be 2.11.0

# Confirm Node version is active (nvm not loaded in fresh shells)
export NVM_DIR="$HOME/.nvm"
\. "$NVM_DIR/nvm.sh"
nvm use 22

# Confirm pm2 is running Documenso (or note the process manager being used)
pm2 list
```

Take a backup before patching:

```bash
cd /path/to/documenso
git stash   # if it's a git checkout
# OR
tar czf ~/documenso-pre-patch-$(date +%Y%m%d).tar.gz \
  packages/lib/constants/autosign.ts \
  apps/remix/app/components/general/document-signing/document-signing-initials-field.tsx \
  apps/remix/app/components/general/document-signing/document-signing-auto-sign.tsx \
  packages/ui/components/field/field.tsx \
  apps/remix/app/components/general/document-signing/document-signing-fields.tsx \
  packages/lib/server-only/field/sign-field-with-token.ts \
  packages/lib/utils/logger.ts \
  packages/lib/package.json \
  packages/tsconfig/process-env.d.ts \
  .env.example
```

---

## Patch 1 — Remove INITIALS from auto-signable field types

**File:** `packages/lib/constants/autosign.ts`

**Effect:** Removes Initials from the bulk auto-sign dialog's filter, so it won't list or auto-fill Initials fields even if many exist.

**Replace the entire file with:**

```ts
import { FieldType } from '@prisma/client';

export const AUTO_SIGNABLE_FIELD_TYPES: FieldType[] = [
  FieldType.NAME,
  FieldType.EMAIL,
  FieldType.DATE,
];
```

(The original includes `FieldType.INITIALS` between `NAME` and `EMAIL`. Just delete that line.)

**Note:** This alone is **not sufficient** to stop initials from being auto-filled. The per-field click-to-sign path auto-derives initials independently — Patch 2 addresses that.

---

## Patch 2 — Force manual initials entry per field

**File:** `apps/remix/app/components/general/document-signing/document-signing-initials-field.tsx`

**Effect:** When the signer clicks an Initials field, a modal opens requiring them to type their initials manually. The `signFieldWithToken` mutation only fires after confirmation. The signer's derived initials are shown only as a placeholder hint, never as the actual signed value.

These are **targeted edits** against the stock v2.11.0 file, not a full replacement, so unrelated upstream changes to this component are preserved. Apply the five edits below in order. (Line numbers will differ on v2.11.0; match on the surrounding code.) Patch 8 then layers a double-submit guard onto this same file, and Patch 4c adds `textAlign` to the placeholder.

### 2a — Add the `useState` import

At the very top of the file, add a header comment and the React import:

```tsx
// PATCHED VERSION — forces manual initials entry per field.
//
// What changed vs. upstream:
//   - `onSign` no longer auto-fills with extractInitials(fullName). Instead it
//     opens a modal that requires the signer to type their initials manually.
//   - The actual signFieldWithToken call only fires after the signer confirms
//     the dialog with a non-empty value.
//   - `extractInitials(fullName)` is kept only as a placeholder hint in the input.
//
// Compliance rationale: auto-typed initials don't satisfy our "actively initialed
// each field" requirement. Each field must be manually initialed.
//
// This is a fork-local patch — reapply on upstream merges.
import { useState } from 'react';
```

### 2b — Add the dialog/input/label/button imports

Alongside the existing `@documenso/ui/primitives/...` imports (e.g. near `use-toast`), add:

```tsx
import { Button } from '@documenso/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@documenso/ui/primitives/dialog';
import { Input } from '@documenso/ui/primitives/input';
import { Label } from '@documenso/ui/primitives/label';
```

Verify all three primitives exist on the target install:

```bash
ls packages/ui/primitives/ | grep -E "input|label|dialog"
```

### 2c — Keep derived initials as a hint only

Find:

```tsx
  const initials = extractInitials(fullName);
```

Replace with:

```tsx
  // Kept only as a hint/placeholder — NOT used as the signed value.
  const derivedInitialsHint = extractInitials(fullName);
```

### 2d — Replace `onSign` with prompt state + a new `onConfirmInitials`

Find the existing auto-filling handler:

```tsx
  const onSign = async (authOptions?: TRecipientActionAuth) => {
    try {
      const value = initials ?? '';

      const payload: TSignFieldWithTokenMutationSchema = {
        token: recipient.token,
        fieldId: field.id,
        value,
        isBase64: false,
        authOptions,
      };

      if (onSignField) {
        await onSignField(payload);
        return;
      }

      await signFieldWithToken(payload);

      await revalidate();
    } catch (err) {
```

Replace it with the prompt state, a state-only `onSign`, and a new `onConfirmInitials` that does the actual signing:

```tsx
  // Manual-initials prompt state
  const [promptOpen, setPromptOpen] = useState(false);
  const [typedInitials, setTypedInitials] = useState('');
  const [pendingAuthOptions, setPendingAuthOptions] = useState<TRecipientActionAuth | undefined>(
    undefined,
  );

  // PATCH: instead of immediately signing with derived initials, open the prompt.
  // NOTE: not `async` — it only sets state. Marking it async trips the
  // `@typescript-eslint/require-await` lint the pre-commit hook enforces; the
  // `onSign` prop accepts `Promise<void> | void`, so a sync handler is fine.
  const onSign = (authOptions?: TRecipientActionAuth) => {
    setPendingAuthOptions(authOptions);
    setTypedInitials('');
    setPromptOpen(true);
  };

  const onConfirmInitials = async () => {
    const value = typedInitials.trim();
    if (!value) return;

    try {
      const payload: TSignFieldWithTokenMutationSchema = {
        token: recipient.token,
        fieldId: field.id,
        value,
        isBase64: false,
        authOptions: pendingAuthOptions,
      };

      if (onSignField) {
        await onSignField(payload);
      } else {
        await signFieldWithToken(payload);
        await revalidate();
      }

      setPromptOpen(false);
      setTypedInitials('');
    } catch (err) {
```

> The `catch`/error-handling body that already follows is unchanged. `onRemove` is also unchanged.

### 2e — Wrap the return in a fragment and add the modal

Find the existing `return (` ... `</DocumentSigningFieldContainer>` ... `);` and wrap it in a fragment, appending the dialog:

```tsx
  return (
    <>
      <DocumentSigningFieldContainer
        field={field}
        onSign={onSign}
        onRemove={onRemove}
        type="Initials"
      >
        {isLoading && <DocumentSigningFieldsLoader />}

        {!field.inserted && (
          <DocumentSigningFieldsUninserted>
            <Trans>Initials</Trans>
          </DocumentSigningFieldsUninserted>
        )}

        {field.inserted && (
          <DocumentSigningFieldsInserted textAlign={parsedFieldMeta?.textAlign}>
            {field.customText}
          </DocumentSigningFieldsInserted>
        )}
      </DocumentSigningFieldContainer>

      <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <Trans>Enter your initials</Trans>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="manual-initials-input">
              <Trans>
                Please type your initials for this field. Each initials field must be entered
                individually.
              </Trans>
            </Label>
            <Input
              id="manual-initials-input"
              value={typedInitials}
              onChange={(e) => setTypedInitials(e.target.value)}
              maxLength={6}
              autoFocus
              placeholder={derivedInitialsHint || 'AB'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && typedInitials.trim()) {
                  e.preventDefault();
                  void onConfirmInitials();
                }
              }}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setPromptOpen(false);
                setTypedInitials('');
              }}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Button
              type="button"
              onClick={onConfirmInitials}
              disabled={!typedInitials.trim() || isLoading}
              loading={isLoading}
            >
              <Trans>Confirm</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
```

**Note:** Patch 1 alone is **not sufficient** to stop initials auto-fill — the per-field click-to-sign path (this file) auto-derives initials independently, which is what these edits address. The placeholder gets a `textAlign` prop in Patch 4c.

---

## Patch 3 — Disable the bulk auto-sign dialog (belt-and-suspenders)

**File:** `apps/remix/app/components/general/document-signing/document-signing-auto-sign.tsx`

**Effect:** Raises the threshold so the bulk auto-sign dialog never triggers, regardless of how many auto-fillable fields are on a document. Eliminates the broken state where the dialog opens with 0 matching fields and a disabled Sign button.

**Change:** Find the line near the top of the file:

```tsx
const AUTO_SIGN_THRESHOLD = 5;
```

Replace with:

```tsx
const AUTO_SIGN_THRESHOLD = Number.MAX_SAFE_INTEGER;
```

That's the entire patch — one line.

---

## Patch 4 — Initials field rendering on scaled-down PDFs

**Files:**
- `packages/ui/components/field/field.tsx`
- `apps/remix/app/components/general/document-signing/document-signing-fields.tsx`

**Effect:** Fixes two rendering problems with Initials fields on small / mobile-scaled PDFs:
1. The field box rendered much larger than its printed underline because it kept a
   fixed `px-2` (8px) padding and `ring-2` (2px) border. On a scaled-down field those
   fixed pixels are a large proportion of a small box, so it overflowed the underline.
2. The empty "Initials" placeholder was left-aligned while the filled value honored
   the field's configured `textAlign`, so empty and filled states didn't match.

**Why percentages, not `cqw`:** `FieldRootContainer` is rendered through `FieldContainerPortal`,
which `createPortal`s the box to `#document-field-portal-root` (only present in the multisign
embed view; elsewhere it falls back to `document.body`). Container queries resolve by DOM
ancestry, so the portaled box has no `container-type` ancestor and `cqw` units resolve against
the **viewport** — which would make `px-[4cqw]` *bigger* on mobile. Percentage padding instead
resolves against the parent's width, and the box's parent is the `.absolute` wrapper already
sized in field px, so `px-[4%]` reliably means 4% of the field's own width.

### 4a — `packages/ui/components/field/field.tsx`

In `FieldRootContainer`, the box `className`. Remove the static `ring-2` from the base string
(it moves into the conditional so `ring-1`/`ring-2` never both apply), then update the
conditional block.

**Before:**

```tsx
className={cn(
  'field--FieldRootContainer field-card-container dark-mode-disabled group relative z-20 flex h-full w-full items-center rounded-[2px] bg-white/90 ring-2 ring-gray-200 transition-all',
  color?.base,
  {
    'px-2': field.type !== FieldType.SIGNATURE && field.type !== FieldType.FREE_SIGNATURE,
    'justify-center': !field.inserted,
    'ring-orange-300': isValidating && isFieldUnsignedAndRequired(field),
  },
  className,
)}
```

**After:**

```tsx
className={cn(
  'field--FieldRootContainer field-card-container dark-mode-disabled group relative z-20 flex h-full w-full items-center rounded-[2px] bg-white/90 ring-gray-200 transition-all',
  color?.base,
  {
    // Initials fields are small; use width-relative padding (percentages
    // resolve against the px-sized field wrapper, unlike cqw which would
    // resolve against the viewport because the box is portaled out of any
    // container-query ancestor) and a thinner ring so the box does not
    // overflow the underline on scaled-down (e.g. mobile) PDFs.
    'px-[4%] ring-1': field.type === FieldType.INITIALS,
    'px-2':
      field.type !== FieldType.INITIALS &&
      field.type !== FieldType.SIGNATURE &&
      field.type !== FieldType.FREE_SIGNATURE,
    'ring-2': field.type !== FieldType.INITIALS,
    'justify-center': !field.inserted,
    'ring-orange-300': isValidating && isFieldUnsignedAndRequired(field),
  },
  className,
)}
```

### 4b — `apps/remix/app/components/general/document-signing/document-signing-fields.tsx`

Give `DocumentSigningFieldsUninserted` an optional `textAlign` prop (defaults to `'left'`, so
the other callers — email/name/text/number — are unchanged), mirroring
`DocumentSigningFieldsInserted`.

**Before:**

```tsx
export const DocumentSigningFieldsUninserted = ({ children }: { children: React.ReactNode }) => {
  return (
    <p className="text-foreground group-hover:text-recipient-green whitespace-pre-wrap text-[clamp(0.425rem,25cqw,0.825rem)] duration-200">
      {children}
    </p>
  );
};
```

**After:**

```tsx
type DocumentSigningFieldsUninsertedProps = {
  children: React.ReactNode;

  /**
   * The text alignment of the placeholder.
   *
   * Defaults to left so existing fields are unchanged.
   */
  textAlign?: 'left' | 'center' | 'right';
};

export const DocumentSigningFieldsUninserted = ({
  children,
  textAlign = 'left',
}: DocumentSigningFieldsUninsertedProps) => {
  return (
    <p
      className={cn(
        'text-foreground group-hover:text-recipient-green whitespace-pre-wrap text-[clamp(0.425rem,25cqw,0.825rem)] duration-200',
        {
          '!text-center': textAlign === 'center',
          '!text-right': textAlign === 'right',
        },
      )}
    >
      {children}
    </p>
  );
};
```

> `cn` is already imported in this file.

### 4c — `apps/remix/app/components/general/document-signing/document-signing-initials-field.tsx`

Pass the field's `textAlign` through to the placeholder so the empty "Initials" hint centers the
same way the filled value does. This edits the placeholder added in Patch 2e.

**Before:**

```tsx
        {!field.inserted && (
          <DocumentSigningFieldsUninserted>
            <Trans>Initials</Trans>
          </DocumentSigningFieldsUninserted>
        )}
```

**After:**

```tsx
        {!field.inserted && (
          <DocumentSigningFieldsUninserted textAlign={parsedFieldMeta?.textAlign}>
            <Trans>Initials</Trans>
          </DocumentSigningFieldsUninserted>
        )}
```

> Requires the `textAlign` prop added to `DocumentSigningFieldsUninserted` in Patch 4b.

---

## Patch 5 — Logging: ISO timestamps, daily file rotation, configurable level

**Files:**
- `packages/lib/utils/logger.ts`
- `packages/lib/package.json` (adds the `pino-roll` dependency)
- `packages/tsconfig/process-env.d.ts`
- `.env.example`

**Effect:**
- JSON/file logs emit ISO-8601 timestamps (`"time":"2026-06-03T20:29:23.496Z"`) instead of
  epoch milliseconds, so entries are readable and easy to correlate with issues.
- The `pino-pretty` dev output prints a full date + time, not just time-of-day.
- When `NEXT_PRIVATE_LOGGER_FILE_PATH` is set, file logs roll **daily** via `pino-roll`, producing
  `documenso.YYYY-MM-DD.1.log` plus a `current.log` symlink. **Note the semantics change:** this
  env var is now a **directory**, not a single file path.
- The minimum log level is configurable via `NEXT_PRIVATE_LOGGER_LEVEL` (default `info`).

> Caveat: Documenso's own code only logs at `info` (and one `error`) — there are no `debug`/`trace`
> statements — so lowering the level surfaces nothing new today; it mainly future-proofs and lets
> you raise the floor to `warn`/`error` to quiet logs.

### 5a — Add the `pino-roll` dependency to `packages/lib/package.json`

Under `dependencies`, alongside the existing `pino` / `pino-pretty` entries:

```jsonc
"pino": "^9.7.0",
"pino-pretty": "^13.0.0",
"pino-roll": "^3.1.0",
```

Then run `npm install` (this is a **real dependency add** — do not skip the install step at deploy).
`pino-roll` runs in a pino transport worker thread that `require()`s it by name at runtime, so it
must be present in `node_modules` where the server runs (and baked into any Docker image).

### 5b — Replace `packages/lib/utils/logger.ts` transport + root config

Add the `node:path` import, configure the level, swap the single-file `pino/file` transport for
`pino-roll`, set `translateTime` on `pino-pretty`, and set ISO timestamps on the root logger.

**Full file:**

```ts
import { join } from 'node:path';
import { type TransportTargetOptions, pino } from 'pino';

import type { BaseApiLog } from '../types/api-logs';
import { extractRequestMetadata } from '../universal/extract-request-metadata';
import { env } from './env';

// The minimum level to log. Set `NEXT_PRIVATE_LOGGER_LEVEL` to one of pino's
// levels (trace, debug, info, warn, error, fatal, silent) to adjust verbosity
// without a code change. `debug`/`trace` are more verbose than the `info`
// default; `warn`/`error` are quieter. Falls back to `info` if unset or invalid.
const PINO_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];
const configuredLevel = env('NEXT_PRIVATE_LOGGER_LEVEL');
const level = configuredLevel && PINO_LEVELS.includes(configuredLevel) ? configuredLevel : 'info';

const transports: TransportTargetOptions[] = [];

if (env('NODE_ENV') !== 'production' && !env('INTERNAL_FORCE_JSON_LOGGER')) {
  transports.push({
    target: 'pino-pretty',
    level,
    options: {
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l o',
    },
  });
}

const loggingFilePath = env('NEXT_PRIVATE_LOGGER_FILE_PATH');

if (loggingFilePath) {
  // Roll the log file daily, producing files named `documenso.YYYY-MM-DD.1.log`
  // (pino-roll hardcodes a `.` before the date and always appends a rotation
  // index, which stays `1` for daily-only rotation). A `current.log` symlink in
  // the same directory always points at the active file.
  // `NEXT_PRIVATE_LOGGER_FILE_PATH` is the directory to write these files into.
  transports.push({
    target: 'pino-roll',
    level,
    options: {
      file: join(loggingFilePath, 'documenso'),
      frequency: 'daily',
      dateFormat: 'yyyy-MM-dd',
      extension: '.log',
      mkdir: true,
      symlink: true,
    },
  });
}

export const logger = pino({
  level,
  // Emit ISO-8601 timestamps (e.g. "2026-06-03T20:29:23.496Z") instead of the
  // default epoch milliseconds so JSON/file logs are human-readable and easy to
  // correlate with issues. pino-pretty output is configured via translateTime above.
  timestamp: pino.stdTimeFunctions.isoTime,
  transport:
    transports.length > 0
      ? {
          targets: transports,
        }
      : undefined,
});

export const logDocumentAccess = ({
  request,
  documentId,
  userId,
}: {
  request: Request;
  documentId: number;
  userId: number;
}) => {
  const metadata = extractRequestMetadata(request);

  const data: BaseApiLog = {
    ipAddress: metadata.ipAddress,
    userAgent: metadata.userAgent,
    path: new URL(request.url).pathname,
    auth: 'session',
    source: 'app',
    userId,
  };

  logger.info({
    ...data,
    input: {
      documentId,
    },
  });
};
```

### 5c — `packages/tsconfig/process-env.d.ts`

Add the new env var type next to `NEXT_PRIVATE_LOGGER_FILE_PATH`:

```ts
    NEXT_PRIVATE_LOGGER_FILE_PATH?: string;
    NEXT_PRIVATE_LOGGER_LEVEL?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';
```

### 5d — `.env.example`

Update the `[[LOGGER]]` block:

```bash
# [[LOGGER]]
# OPTIONAL: Directory to write log files to. When set, logs are rolled daily into
# `documenso.YYYY-MM-DD.1.log` files (a `current.log` symlink points at the active file).
NEXT_PRIVATE_LOGGER_FILE_PATH=
# OPTIONAL: Minimum log level: trace, debug, info, warn, error, fatal, or silent. Defaults to info.
NEXT_PRIVATE_LOGGER_LEVEL=
```

---

## Patch 6 — PM2 ecosystem config with log timestamps

**File:** `ecosystem.config.js` (new, at the repo root)

**Effect:** PM2-captured stdout/stderr (`~/.pm2/logs/documenso-{out,error}.log`) lacked timestamps.
The `out.log` contains pino JSON (now ISO-stamped after Patch 5), but `error.log` is raw
`console.error` / framework output that pino never touches. Setting `time: true` makes PM2 prefix
**every** captured line in both files with an ISO timestamp, covering all sources.

**Create `ecosystem.config.js` at the repo root** (the root package is CommonJS, so `.js` with
`module.exports` is correct; adjust `cwd` if the install path differs):

```js
// PM2 process configuration for Documenso.
//
// Apply with:
//   pm2 delete documenso 2>/dev/null; pm2 start ecosystem.config.js && pm2 save
//
// `time: true` prefixes every captured stdout/stderr line in
// ~/.pm2/logs/documenso-{out,error}.log with an ISO timestamp, covering both
// pino output and raw console.* / framework logging.
module.exports = {
  apps: [
    {
      name: 'documenso',
      cwd: '/var/www/documenso/apps/remix',
      script: 'npm',
      args: 'start',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      time: true,
      merge_logs: true,
    },
  ],
};
```

**Apply it** (the existing process was started ad-hoc, so a plain `pm2 reload` won't pick up the
config — delete and re-add, then persist):

```bash
cd /path/to/documenso
pm2 delete documenso
pm2 start ecosystem.config.js
pm2 save
```

---

## Patch 7 — Make `signFieldWithToken` idempotent on already-inserted fields

**File:** `packages/lib/server-only/field/sign-field-with-token.ts`

**Effect:** Previously, signing a field that was already inserted threw
`Field <id> has already been inserted` (surfacing as a 5xx). This endpoint frequently
sees client retries (tRPC/SWR retry on transient failures, remounts, navigation), so the
server now treats an already-inserted field as a successful no-op and returns the existing
field. Logged at `warn` so pathological retry loops are still visible. This is the
server-side complement to Patch 8 (client-side double-submit guard).

**Change:** Add the `logger` import alongside the other `../../utils/...` imports:

```ts
import { logger } from '../../utils/logger';
```

Then, in the `signFieldWithToken` function, replace the already-inserted guard.

**Before:**

```ts
  if (field.inserted) {
    throw new Error(`Field ${fieldId} has already been inserted`);
  }
```

**After:**

```ts
  if (field.inserted) {
    // Idempotency: treat as a successful no-op rather than a 5xx error.
    // This endpoint frequently sees client retries (tRPC/SWR retry on transient
    // failures, remounts, navigation, etc.) — once a field is inserted the work
    // is done, so returning the existing field is the safe response.
    // Logged at warn level so we can still spot pathological retry loops.
    logger.warn(
      { fieldId, recipientId: recipient.id, type: field.type },
      `signFieldWithToken called on already-inserted field ${fieldId} — returning existing field (idempotent no-op)`,
    );
    return field;
  }
```

---

## Patch 8 — Guard the initials field against double-submit

**File:** `apps/remix/app/components/general/document-signing/document-signing-initials-field.tsx`

**Effect:** Adds an in-flight `useRef` guard so the manual-initials modal can't fire
`onConfirmInitials` twice when a signer presses Enter rapidly or clicks Confirm faster than
React can disable the button. Pairs with Patch 7 on the server. **This builds on Patch 2** —
apply Patch 2 first, then layer these three edits onto that file.

**Edit 1 — import `useRef`.** Change the React import:

```tsx
import { useRef, useState } from 'react';
```

**Edit 2 — declare the guard ref.** After the `pendingAuthOptions` state declaration, add:

```tsx
  // In-flight guard — prevents double-submit when users press Enter rapidly
  // or click Confirm faster than React can disable the button.
  const isSubmittingRef = useRef(false);
```

**Edit 3 — set/clear the guard inside `onConfirmInitials`.** At the top of the function,
after the empty-value check, bail out if already submitting and set the flag; clear it in a
`finally`:

```tsx
  const onConfirmInitials = async () => {
    const value = typedInitials.trim();
    if (!value) return;
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    try {
      // ... existing payload / signFieldWithToken / revalidate logic ...
    } catch (err) {
      // ... existing error handling ...
    } finally {
      // eslint-disable-next-line require-atomic-updates
      isSubmittingRef.current = false;
    }
  };
```

**Edit 4 — also gate the Enter-key handler** on the input. Replace the `onKeyDown` condition:

```tsx
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  typedInitials.trim() &&
                  !isLoading &&
                  !isSubmittingRef.current
                ) {
                  e.preventDefault();
                  void onConfirmInitials();
                }
              }}
```

---

## Patch 9 — Re-establish container-query context on the field box

**File:** `packages/ui/components/field/field.tsx`

**Effect:** Builds on Patch 4a. The `cqw`-based text sizing inside the field (see Patch 10)
needs a query container to resolve against. The `[container-type:size]` set on the wrapper in
`DocumentSigningFieldContainer` doesn't survive `FieldContainerPortal`, so `cqw` units were
resolving against the viewport instead of the field's rendered width. This re-establishes a
query container directly on the box and clips overflow.

**Change:** In `FieldRootContainer`, add `overflow-hidden` and `[container-type:inline-size]`
to the box's base `className` string (this is the same string edited in Patch 4a).

**Before** (post-Patch-4a base string):

```tsx
'field--FieldRootContainer field-card-container dark-mode-disabled group relative z-20 flex h-full w-full items-center rounded-[2px] bg-white/90 ring-gray-200 transition-all',
```

**After:**

```tsx
// [container-type:inline-size] makes cqw-based text sizing inside the
// field (e.g. DocumentSigningFieldsInserted) resolve against the field's
// actual rendered width rather than the viewport. The [container-type:size]
// on the wrapper in DocumentSigningFieldContainer does not survive the
// FieldContainerPortal, so we re-establish a query container here.
'field--FieldRootContainer field-card-container dark-mode-disabled group relative z-20 flex h-full w-full items-center overflow-hidden rounded-[2px] bg-white/90 ring-gray-200 transition-all [container-type:inline-size]',
```

(Only `overflow-hidden` and `[container-type:inline-size]` are added; the conditional `px`/`ring`
block from Patch 4a is unchanged.)

---

## Patch 10 — Responsive font sizing for placeholder and inserted field values

**File:** `apps/remix/app/components/general/document-signing/document-signing-fields.tsx`

**Effect:** Builds on Patch 4b. Splits font sizing by viewport so values fit small mobile
fields without looking tiny on desktop, and stops long inserted values (e.g.
`06/04/2026 10:18 PM`) from wrapping/clipping on narrow fields. Mobile uses a smaller `clamp`
cap; desktop (`md:+`) uses a larger one. Inserted values get `whitespace-nowrap` + `overflow-hidden`.
Requires Patch 9's `[container-type:inline-size]` for the `cqw` units to resolve correctly.

### 10a — `DocumentSigningFieldsUninserted` (placeholder)

Replace the single `text-[clamp(...)]` class (added in Patch 4b) with the responsive pair.

**Before:**

```tsx
className={cn(
  'text-foreground group-hover:text-recipient-green whitespace-pre-wrap text-[clamp(0.425rem,25cqw,0.825rem)] duration-200',
  {
    '!text-center': textAlign === 'center',
    '!text-right': textAlign === 'right',
  },
)}
```

**After:**

```tsx
className={cn(
  // Responsive font sizing for the placeholder label:
  //   - mobile (default): clamp(0.4rem, 18cqw, 0.7rem)    — modest size
  //   - desktop (md:+):   clamp(0.55rem, 26cqw, 1.1rem)  — larger so the
  //     placeholder doesn't look tiny in short fields like Initials.
  'text-foreground group-hover:text-recipient-green whitespace-pre-wrap leading-tight duration-200',
  'text-[clamp(0.4rem,18cqw,0.7rem)] md:text-[clamp(0.55rem,26cqw,1.1rem)]',
  {
    '!text-center': textAlign === 'center',
    '!text-right': textAlign === 'right',
  },
)}
```

### 10b — `DocumentSigningFieldsInserted` (filled value)

**Before:**

```tsx
className={cn(
  'text-foreground w-full whitespace-pre-wrap text-left text-[clamp(0.425rem,25cqw,0.825rem)] duration-200',
  {
    '!text-center': textAlign === 'center',
    '!text-right': textAlign === 'right',
  },
)}
```

**After:**

```tsx
className={cn(
  // whitespace-nowrap so values like "06/04/2026 10:18 PM" don't wrap at
  // a space and get clipped by the field's height on narrow mobile fields.
  //
  // Font sizing is split by viewport:
  //   - mobile (default):  clamp(0.35rem, 12cqw, 0.7rem)  — smaller cap
  //     so long values still fit horizontally on narrow field widths.
  //   - desktop (md:+):    clamp(0.5rem,  20cqw, 1rem)    — larger cap
  //     so short values like initials remain readable on desktop fields.
  'text-foreground w-full overflow-hidden whitespace-nowrap text-left leading-tight duration-200',
  'text-[clamp(0.35rem,12cqw,0.6rem)] md:text-[clamp(0.5rem,20cqw,1.1rem)]',
  {
    '!text-center': textAlign === 'center',
    '!text-right': textAlign === 'right',
  },
)}
```

---

## Deployment

Run from the Documenso install root:

```bash
# Activate Node
export NVM_DIR="$HOME/.nvm"
\. "$NVM_DIR/nvm.sh"
nvm use 22

cd /path/to/documenso

# Install deps — REQUIRED: Patch 5 adds the `pino-roll` dependency, which the
# pino transport worker resolves by name at runtime. Do not skip this.
npm install

# Build
npm run build

# Restart pm2.
# If Patch 6 (ecosystem.config.js) has been applied, re-register from it so the
# time:true setting takes effect (a plain restart won't pick up an ad-hoc process):
pm2 delete documenso && pm2 start ecosystem.config.js && pm2 save
# Otherwise, a plain restart is fine (adjust process name if different):
#   pm2 restart documenso
pm2 logs documenso --lines 50 --nostream
```

If the install uses something other than pm2 (systemd, Docker, etc.), substitute the appropriate restart command. The key is that the Node process serving the Remix app must be restarted to pick up the new bundle.

---

## Verification

Test these flows on the freshly patched install:

1. **Patch 1 verification — bulk auto-sign dialog**
   Create a test document with 6+ INITIALS fields. Open the signing link. The bulk auto-sign dialog must not list "Initials" as an auto-fillable type. (With Patch 3 also applied, the dialog should never open at all.)

2. **Patch 2 verification — manual initials prompt**
   Open the signing link, click any Initials field. The "Enter your initials" modal must appear. Confirm:
   - The placeholder shows the signer's derived initials as a hint.
   - The input is empty by default.
   - Confirm is disabled until the signer types something.
   - Cancel closes the modal without signing.
   - Confirm signs the field with the typed value (not the derived one).

3. **Patch 3 verification — no bulk dialog**
   Same test document as #1. The bulk auto-sign dialog should never appear, even with many auto-fillable fields.

4. **Regression check — Signature fields still work**
   Drop a Signature field on a test doc. Confirm signing it still uses the normal draw/type/upload pad. (These patches don't touch signature handling, but worth confirming.)

5. **Regression check — Name/Email/Date fields**
   These can still auto-fill via per-field click since Patch 2 only addresses Initials. If "actively typed" intent applies to Name as well, replicate the Patch 2 pattern in `document-signing-name-field.tsx`. (See Open Issues below.)

6. **Patch 4 verification — Initials rendering on mobile**
   Open a document with an Initials field on a phone (or a narrow/zoomed-out desktop view so the
   PDF scales down). Confirm the field box (border/padding) sits within the printed underline and
   doesn't overflow it, and that the empty "Initials" placeholder is centered the same way the
   filled value is. Check both empty and filled states. Confirm other field types (text/name/email)
   look unchanged.

7. **Patch 5 verification — logging**
   - Without `NEXT_PRIVATE_LOGGER_FILE_PATH`: confirm log lines carry an ISO `time`
     (`"time":"2026-...Z"`), not an epoch integer.
   - Set `NEXT_PRIVATE_LOGGER_FILE_PATH` to a **directory** and restart. Confirm a
     `documenso.YYYY-MM-DD.1.log` file and a `current.log` symlink appear in it.
   - Set `NEXT_PRIVATE_LOGGER_LEVEL=warn`, restart, and confirm `info` lines are suppressed.

8. **Patch 6 verification — PM2 timestamps**
   After `pm2 start ecosystem.config.js`, run `pm2 logs documenso --lines 20 --nostream` (or tail
   `~/.pm2/logs/documenso-{out,error}.log`) and confirm every line is prefixed with an ISO
   timestamp. `pm2 describe documenso` should show the time option enabled.

9. **Patch 7 verification — idempotent signing**
   Sign an Initials field, then trigger a re-submit of the same field (e.g. rapid retry or replay the
   request). The server must return the existing field (HTTP 200), not a 5xx, and emit a `warn` log
   line `signFieldWithToken called on already-inserted field ...`.

10. **Patch 8 verification — no double-submit**
    In the manual-initials modal, type initials and press Enter repeatedly / mash Confirm. Only one
    sign request should fire; the field should sign exactly once with no error toast.

11. **Patches 9–10 verification — responsive sizing on mobile and desktop**
    Open a document with Initials and a long-value field (e.g. a Date showing `06/04/2026 10:18 PM`).
    On a phone / narrow view: confirm the value stays on one line and isn't clipped, and text isn't
    overflowing the field box. On desktop (`md:+`): confirm placeholders and short values are
    comfortably readable (larger cap) rather than tiny. Check both empty and filled states.

---

## Open issues / known gaps

These were identified during the original investigation but not yet resolved. Track and decide whether to patch on the new install:

1. **Name field has the same auto-derive pattern.**
   `apps/remix/app/components/general/document-signing/document-signing-name-field.tsx` likely auto-fills from `fullName` on click using the same architecture. If "actively typed" intent applies to Name, mirror Patch 2 there.

2. **iOS Safari "page repeatedly crashed" on /sign/<token>.**
   Reported on `documenso.cloudpress.host` — Safari mobile bails out repeatedly. Causes under investigation: JS heap exhaustion on large PDFs, infinite render loop, PDF.js worker crash. Remote-inspect from Mac Safari (Develop → [iPhone] → tab) to get the console errors. Not patch-related as far as we know, but worth checking on the new install.

3. **Maintenance debt.**
   All three patches are fork-local. Document their location (this file) so they can be reapplied after every upstream merge. Consider maintaining them as a long-lived branch or git patch files (`git format-patch`) for cleaner re-application.

---

## File locations summary

| Patch | File | Type |
|-------|------|------|
| 1 | `packages/lib/constants/autosign.ts` | Full replace |
| 2 | `apps/remix/app/components/general/document-signing/document-signing-initials-field.tsx` | Targeted edits (2a–2e) |
| 3 | `apps/remix/app/components/general/document-signing/document-signing-auto-sign.tsx` | One-line change |
| 4a | `packages/ui/components/field/field.tsx` | Targeted edit (box className) |
| 4b | `apps/remix/app/components/general/document-signing/document-signing-fields.tsx` | Targeted edit (add `textAlign` prop) |
| 4c | `apps/remix/app/components/general/document-signing/document-signing-initials-field.tsx` | Targeted edit (pass `textAlign` to placeholder) |
| 5a | `packages/lib/package.json` | Add `pino-roll` dependency |
| 5b | `packages/lib/utils/logger.ts` | Full replace |
| 5c | `packages/tsconfig/process-env.d.ts` | Add one env type |
| 5d | `.env.example` | Update `[[LOGGER]]` block |
| 6 | `ecosystem.config.js` | New file (repo root) |
| 7 | `packages/lib/server-only/field/sign-field-with-token.ts` | Add import + replace inserted-field guard |
| 8 | `apps/remix/app/components/general/document-signing/document-signing-initials-field.tsx` | Targeted edits (layers on Patch 2) |
| 9 | `packages/ui/components/field/field.tsx` | Targeted edit (same className as Patch 4a) |
| 10 | `apps/remix/app/components/general/document-signing/document-signing-fields.tsx` | Targeted edits (same classNames as Patch 4b) |

---

## Rollback

If any patch causes problems, revert from the pre-patch backup:

```bash
cd /path/to/documenso
tar xzf ~/documenso-pre-patch-YYYYMMDD.tar.gz
npm run build
pm2 restart documenso
```

Or, if using git:
```bash
git checkout HEAD -- packages/lib/constants/autosign.ts \
  apps/remix/app/components/general/document-signing/document-signing-initials-field.tsx \
  apps/remix/app/components/general/document-signing/document-signing-auto-sign.tsx \
  packages/ui/components/field/field.tsx \
  apps/remix/app/components/general/document-signing/document-signing-fields.tsx \
  packages/lib/server-only/field/sign-field-with-token.ts \
  packages/lib/utils/logger.ts \
  packages/lib/package.json \
  packages/tsconfig/process-env.d.ts \
  .env.example
rm -f ecosystem.config.js   # Patch 6 (untracked new file)
npm install                 # restore lockfile state (drops pino-roll)
npm run build
pm2 restart documenso
```

