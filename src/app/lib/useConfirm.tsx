import { useState, useCallback, ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "../components/ui/alert-dialog";

interface ConfirmOptions {
  title?: string;
  description?: string | ReactNode;
  /** Rich body rendered below the header, e.g. a summary of what is about
   *  to happen (the proclamation summary in the final proclaim confirm). */
  content?: ReactNode;
  /** Extra classes for the dialog panel — e.g. a wider max width when the
   *  content is a rich summary (the proclamation final confirm lists every
   *  winner with their full name and position).  Merged over the default
   *  sm:max-w-lg, so later utility classes win. */
  className?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

export function useConfirm(options: ConfirmOptions = {}) {
  const {
    title = "Are you sure?",
    description = "This action cannot be undone.",
    confirmText = "Continue",
    cancelText = "Cancel",
    destructive = false,
  } = options;

  const [open, setOpen] = useState(false);
  const [resolver, setResolver] = useState<((value: boolean) => void) | null>(null);
  // Per-call overrides — a call may enrich the dialog (e.g. attach a summary)
  // without every caller of this hook instance seeing it.
  const [overrides, setOverrides] = useState<Partial<ConfirmOptions>>({});

  const confirm = useCallback((callOptions?: Partial<ConfirmOptions>): Promise<boolean> => {
    return new Promise((resolve) => {
      setOverrides(callOptions ?? {});
      setOpen(true);
      setResolver(() => resolve);
    });
  }, []);

  const handleConfirm = () => {
    setOpen(false);
    resolver?.(true);
  };

  const handleCancel = () => {
    setOpen(false);
    resolver?.(false);
  };

  const effective: ConfirmOptions = {
    title,
    description,
    confirmText,
    cancelText,
    destructive,
    ...overrides,
  };

  const dialog = (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) handleCancel(); }}>
      <AlertDialogContent className={effective.className}>
        <AlertDialogHeader>
          <AlertDialogTitle>{effective.title}</AlertDialogTitle>
          <AlertDialogDescription>{effective.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {effective.content}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>{effective.cancelText}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className={effective.destructive ? "bg-red-600 hover:bg-red-700 text-white" : undefined}
          >
            {effective.confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, dialog };
}
