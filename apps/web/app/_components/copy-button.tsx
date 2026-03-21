'use client';

import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, type ButtonProps } from '@plusmy/ui';

type CopyButtonProps = Omit<ButtonProps, 'onClick' | 'children'> & {
  value: string;
  label: string;
  copiedLabel?: string;
};

function fallbackCopy(text: string) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

export function CopyButton({ value, label, copiedLabel = 'Copied', size = 'sm', variant = 'outline', ...props }: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return undefined;

    const timeout = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function handleCopy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        fallbackCopy(value);
      }
      setCopied(true);
    } catch {
      fallbackCopy(value);
      setCopied(true);
    }
  }

  return (
    <Button type="button" size={size} variant={variant} onClick={handleCopy} {...props}>
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? copiedLabel : label}
    </Button>
  );
}
