import { LogIn, LogOut, User, Loader2 } from 'lucide-react';
import type { AuthState } from '@/types';

interface AuthButtonProps {
  authState: AuthState;
  loading:   boolean;
  onSignIn:  () => void;
  onSignOut: () => void;
}

export function AuthButton({ authState, loading, onSignIn, onSignOut }: AuthButtonProps) {
  if (loading) {
    return (
      <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-surface-800 border border-white/5">
        <Loader2 size={15} className="text-brand-400 animate-spin flex-shrink-0" />
        <span className="text-sm text-slate-400">Connecting to Google…</span>
      </div>
    );
  }

  if (authState.isAuthenticated) {
    return (
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 animate-fade-in">
        {/* Avatar + identity */}
        <div className="flex items-center gap-2.5 min-w-0">
          {authState.picture ? (
            <img
              src={authState.picture}
              alt="Google profile"
              className="w-8 h-8 rounded-full border border-emerald-500/30 flex-shrink-0 object-cover"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
              <User size={14} className="text-emerald-400" />
            </div>
          )}
          <div className="min-w-0">
            {authState.displayName && (
              <p className="text-xs font-semibold text-slate-200 leading-none truncate">
                {authState.displayName}
              </p>
            )}
            {authState.email && (
              <p className="text-xs text-slate-400 leading-none mt-0.5 truncate">
                {authState.email}
              </p>
            )}
          </div>
        </div>

        {/* Disconnect */}
        <button
          id="btn-sign-out"
          onClick={onSignOut}
          title="Disconnect Google account"
          className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300 active:bg-red-500/20 transition-colors"
        >
          <LogOut size={12} />
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      id="btn-sign-in"
      onClick={onSignIn}
      className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl
        bg-gradient-to-br from-brand-600 to-brand-700
        hover:from-brand-500 hover:to-brand-600
        active:from-brand-700 active:to-brand-800
        text-white font-semibold text-sm
        shadow-lg shadow-brand-900/50 hover:shadow-brand-600/30
        transition-all duration-200 animate-fade-in"
    >
      <LogIn size={16} />
      Connect Google Account
    </button>
  );
}
