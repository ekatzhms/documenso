import { Loader } from 'lucide-react';

import { cn } from '@documenso/ui/lib/utils';

export const DocumentSigningFieldsLoader = () => {
  return (
    <div className="bg-background absolute inset-0 flex items-center justify-center rounded-md">
      <Loader className="text-primary h-5 w-5 animate-spin md:h-8 md:w-8" />
    </div>
  );
};

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
        'text-foreground group-hover:text-recipient-green whitespace-pre-wrap text-[clamp(0.4rem,16cqw,0.7rem)] leading-tight duration-200',
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

type DocumentSigningFieldsInsertedProps = {
  children: React.ReactNode;

  /**
   * The text alignment of the field.
   *
   * Defaults to left.
   */
  textAlign?: 'left' | 'center' | 'right';
};

export const DocumentSigningFieldsInserted = ({
  children,
  textAlign = 'left',
}: DocumentSigningFieldsInsertedProps) => {
  return (
    <div className="flex h-full w-full items-center overflow-hidden">
      <p
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
      >
        {children}
      </p>
    </div>
  );
};
