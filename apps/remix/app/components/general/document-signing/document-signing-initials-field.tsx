// PATCHED VERSION — forces manual initials entry per field.
// Drop-in replacement for:
//   apps/remix/app/components/general/document-signing/document-signing-initials-field.tsx
//
// What changed vs. upstream:
//   - `onSign` no longer auto-fills with extractInitials(fullName). Instead it
//     opens a modal that requires the signer to type their initials manually.
//   - The actual signFieldWithToken call only fires after the signer confirms
//     the dialog with a non-empty value.
//   - `extractInitials(fullName)` is kept only as a placeholder hint in the input
//     so the signer can see what their derived initials would have been.
//
// Compliance rationale: auto-typed initials don't satisfy our "actively initialed
// each field" requirement. Each field must be manually initialed.
//
// This is a fork-local patch — reapply on upstream merges.
import { useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { useRevalidator } from 'react-router';

import { DO_NOT_INVALIDATE_QUERY_ON_MUTATION } from '@documenso/lib/constants/trpc';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import type { TRecipientActionAuth } from '@documenso/lib/types/document-auth';
import { ZInitialsFieldMeta } from '@documenso/lib/types/field-meta';
import { extractInitials } from '@documenso/lib/utils/recipient-formatter';
import type { FieldWithSignature } from '@documenso/prisma/types/field-with-signature';
import { trpc } from '@documenso/trpc/react';
import type {
  TRemovedSignedFieldWithTokenMutationSchema,
  TSignFieldWithTokenMutationSchema,
} from '@documenso/trpc/server/field-router/schema';
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
import { useToast } from '@documenso/ui/primitives/use-toast';

import { DocumentSigningFieldContainer } from './document-signing-field-container';
import {
  DocumentSigningFieldsInserted,
  DocumentSigningFieldsLoader,
  DocumentSigningFieldsUninserted,
} from './document-signing-fields';
import { useRequiredDocumentSigningContext } from './document-signing-provider';
import { useDocumentSigningRecipientContext } from './document-signing-recipient-provider';

export type DocumentSigningInitialsFieldProps = {
  field: FieldWithSignature;
  onSignField?: (value: TSignFieldWithTokenMutationSchema) => Promise<void> | void;
  onUnsignField?: (value: TRemovedSignedFieldWithTokenMutationSchema) => Promise<void> | void;
};

export const DocumentSigningInitialsField = ({
  field,
  onSignField,
  onUnsignField,
}: DocumentSigningInitialsFieldProps) => {
  const { toast } = useToast();
  const { _ } = useLingui();
  const { revalidate } = useRevalidator();

  const { fullName } = useRequiredDocumentSigningContext();
  const { recipient, isAssistantMode } = useDocumentSigningRecipientContext();

  // Kept only as a hint/placeholder — NOT used as the signed value.
  const derivedInitialsHint = extractInitials(fullName);

  const { mutateAsync: signFieldWithToken, isPending: isSignFieldWithTokenLoading } =
    trpc.field.signFieldWithToken.useMutation(DO_NOT_INVALIDATE_QUERY_ON_MUTATION);

  const {
    mutateAsync: removeSignedFieldWithToken,
    isPending: isRemoveSignedFieldWithTokenLoading,
  } = trpc.field.removeSignedFieldWithToken.useMutation(DO_NOT_INVALIDATE_QUERY_ON_MUTATION);

  const isLoading = isSignFieldWithTokenLoading || isRemoveSignedFieldWithTokenLoading;

  const safeFieldMeta = ZInitialsFieldMeta.safeParse(field.fieldMeta);
  const parsedFieldMeta = safeFieldMeta.success ? safeFieldMeta.data : null;

  // Manual-initials prompt state
  const [promptOpen, setPromptOpen] = useState(false);
  const [typedInitials, setTypedInitials] = useState('');
  const [pendingAuthOptions, setPendingAuthOptions] = useState<TRecipientActionAuth | undefined>(
    undefined,
  );

  // PATCH: instead of immediately signing with derived initials, open the prompt.
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
      const error = AppError.parseError(err);

      if (error.code === AppErrorCode.UNAUTHORIZED) {
        throw error;
      }

      console.error(err);

      toast({
        title: _(msg`Error`),
        description: isAssistantMode
          ? _(msg`An error occurred while signing as assistant.`)
          : _(msg`An error occurred while signing the document.`),
        variant: 'destructive',
      });
    }
  };

  const onRemove = async () => {
    try {
      const payload: TRemovedSignedFieldWithTokenMutationSchema = {
        token: recipient.token,
        fieldId: field.id,
      };

      if (onUnsignField) {
        await onUnsignField(payload);
        return;
      }

      await removeSignedFieldWithToken(payload);
      await revalidate();
    } catch (err) {
      console.error(err);

      toast({
        title: _(msg`Error`),
        description: _(msg`An error occurred while removing the field.`),
        variant: 'destructive',
      });
    }
  };

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
          <DocumentSigningFieldsUninserted textAlign={parsedFieldMeta?.textAlign}>
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
};
