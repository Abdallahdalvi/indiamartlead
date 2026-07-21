import React from 'react';
import { CheckCircle, XCircle, SkipForward, Clock, Loader2, AlertCircle } from 'lucide-react';

export type BadgeStatus = 'imported' | 'duplicate' | 'error' | 'skipped' | 'idle' | 'syncing';

interface Config {
  label:     string;
  Icon:      React.ElementType;
  className: string;
  spin?:     boolean;
}

const STATUS_MAP: Record<BadgeStatus, Config> = {
  imported:  { label: 'Imported',  Icon: CheckCircle,  className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  duplicate: { label: 'Duplicate', Icon: SkipForward,  className: 'bg-amber-500/15  text-amber-400  border-amber-500/30'  },
  error:     { label: 'Error',     Icon: XCircle,      className: 'bg-red-500/15     text-red-400    border-red-500/30'    },
  skipped:   { label: 'Skipped',   Icon: AlertCircle,  className: 'bg-slate-500/15  text-slate-400  border-slate-500/30'  },
  idle:      { label: 'Ready',     Icon: Clock,        className: 'bg-slate-500/15  text-slate-400  border-slate-500/30'  },
  syncing:   { label: 'Syncing…',  Icon: Loader2,      className: 'bg-brand-500/15  text-brand-400  border-brand-500/30', spin: true },
};

interface StatusBadgeProps {
  status:   BadgeStatus;
  message?: string;
}

export function StatusBadge({ status, message }: StatusBadgeProps) {
  const { label, Icon, className, spin } = STATUS_MAP[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${className}`}
    >
      <Icon size={11} className={spin ? 'animate-spin' : ''} />
      {message ?? label}
    </span>
  );
}
