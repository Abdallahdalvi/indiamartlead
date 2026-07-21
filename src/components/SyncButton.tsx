import React from 'react';
import { Upload, Loader2, CheckCircle, Copy, XCircle } from 'lucide-react';
import type { SyncResult } from '@/types';

type Variant = 'primary' | 'secondary' | 'ghost';

interface SyncButtonProps {
  id:        string;
  label:     string;
  icon?:     React.ElementType;
  onClick:   () => void;
  disabled?: boolean;
  loading?:  boolean;
  result?:   SyncResult | null;
  variant?:  Variant;
}

const RESULT_ICONS: Partial<Record<SyncResult['status'], React.ReactElement>> = {
  imported:  <CheckCircle size={15} className="text-emerald-400" />,
  duplicate: <Copy        size={15} className="text-amber-400"   />,
  error:     <XCircle     size={15} className="text-red-400"     />,
};

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    'bg-gradient-to-br from-brand-600 to-brand-700 hover:from-brand-500 hover:to-brand-600 ' +
    'active:from-brand-700 text-white shadow-md shadow-brand-900/40 hover:shadow-brand-600/20',
  secondary:
    'bg-surface-800 hover:bg-surface-700 active:bg-surface-800 ' +
    'text-slate-300 border border-white/5 hover:border-white/10',
  ghost:
    'text-slate-400 hover:text-slate-200 hover:bg-white/5',
};

export function SyncButton({
  id, label, icon: Icon = Upload,
  onClick, disabled, loading, result, variant = 'primary',
}: SyncButtonProps) {
  const isDisabled = disabled || loading;
  const resultIcon = result ? RESULT_ICONS[result.status] : null;

  return (
    <button
      id={id}
      onClick={onClick}
      disabled={isDisabled}
      className={`
        w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
        font-medium text-sm transition-all duration-200
        disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none
        ${VARIANT_CLASSES[variant]}
      `}
    >
      {loading
        ? <Loader2 size={15} className="animate-spin" />
        : (resultIcon ?? <Icon size={15} />)
      }
      {label}
    </button>
  );
}
