
import React from 'react';
import { Profile } from '../types';

interface ProfileCardProps {
  profile: Profile;
  isCurrentUser?: boolean;
  matchScore?: number; // 0-100
  canDelete?: boolean;
  onDelete?: (id: string) => void;
  isAnalyzing?: boolean;
}

export const ProfileCard: React.FC<ProfileCardProps> = ({ 
  profile, 
  isCurrentUser,
  matchScore,
  canDelete,
  onDelete,
  isAnalyzing
}) => {
  const getMatchTier = (score: number | undefined) => {
    if (isCurrentUser) return { 
      label: 'YOU', 
      color: 'indigo', 
      border: 'border-indigo-500 shadow-[0_0_30px_rgba(99,102,241,0.4)] ring-4 ring-indigo-500/20', 
      bg: 'bg-indigo-600' 
    };
    if (isAnalyzing) return { 
      label: 'ANALYZING...', 
      color: 'slate', 
      border: 'border-white/10 animate-pulse', 
      bg: 'bg-slate-700' 
    };
    if (score === undefined || score === 0) return { 
      label: 'PARTICIPANT', 
      color: 'slate', 
      border: 'border-white/10', 
      bg: 'bg-slate-800' 
    };
    if (score >= 80) return { 
      label: 'BEST MATCH', 
      color: 'emerald', 
      border: 'border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.3)]', 
      bg: 'bg-emerald-600' 
    };
    if (score >= 50) return { 
      label: 'GOOD MATCH', 
      color: 'amber', 
      border: 'border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.2)]', 
      bg: 'bg-amber-600' 
    };
    return { 
      label: 'POTENTIAL', 
      color: 'slate', 
      border: 'border-white/5', 
      bg: 'bg-slate-700' 
    };
  };

  const tier = getMatchTier(matchScore);
  
  const colorMap: Record<string, string> = {
    indigo: 'bg-indigo-500 text-white ring-indigo-400/50',
    emerald: 'bg-emerald-500 text-white ring-emerald-400/50',
    amber: 'bg-amber-500 text-white ring-amber-400/50',
    slate: 'bg-slate-700 text-slate-200 ring-slate-400/30'
  };

  return (
    <div className={`group relative flex flex-col p-6 rounded-[2.5rem] bg-slate-900 border-2 transition-all duration-500 ${tier.border} ${isCurrentUser ? 'scale-[1.04] z-20' : 'hover:scale-[1.02] hover:z-10'}`}>
      
      <div className={`absolute -top-10 -right-10 w-40 h-40 blur-[60px] pointer-events-none transition-opacity duration-700 opacity-30 group-hover:opacity-60 
        ${tier.color === 'indigo' ? 'bg-indigo-600' : 
          tier.color === 'emerald' ? 'bg-emerald-600' : 
          tier.color === 'amber' ? 'bg-amber-600' : 'bg-slate-600'}`}
      ></div>

      <div className="absolute top-5 left-5 right-5 flex justify-between items-start z-10">
        <div className="flex gap-2">
          <span className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ring-2 shadow-lg ${colorMap[tier.color]}`}>
            {tier.label}
          </span>
          {matchScore !== undefined && matchScore > 0 && !isCurrentUser && (
            <span className="px-3 py-1.5 bg-slate-800 text-white rounded-full text-[10px] font-black uppercase tracking-widest ring-2 ring-white/10 backdrop-blur-md shadow-lg">
              {matchScore}%
            </span>
          )}
        </div>
        
        {canDelete && (
          <button 
            onClick={(e) => { e.stopPropagation(); onDelete?.((profile as any).userId || profile.id); }}
            className="p-2 bg-red-500/20 hover:bg-red-500 text-red-500 hover:text-white rounded-xl border border-red-500/30 transition-all opacity-0 group-hover:opacity-100"
            title="Remove card"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>
      
      <div className="flex flex-col items-center text-center mt-12 mb-6">
        <div className="relative mb-4">
          <img 
            src={profile.imageUrl} 
            alt={profile.name} 
            className={`w-20 h-20 rounded-[2rem] object-cover ring-4 ${isCurrentUser ? 'ring-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.6)]' : 'ring-white/10'}`}
          />
          {isCurrentUser && (
            <div className="absolute -bottom-1 -right-1 w-7 h-7 bg-indigo-500 rounded-full border-4 border-slate-900 flex items-center justify-center shadow-xl">
               <div className="w-2.5 h-2.5 bg-white rounded-full animate-ping"></div>
            </div>
          )}
        </div>
        <h3 className={`font-black text-white text-xl tracking-tight mb-1 ${isCurrentUser ? 'text-indigo-100' : ''}`}>
          {profile.name}
        </h3>
        <p className="text-[11px] text-indigo-400 font-black uppercase tracking-[0.1em] opacity-90 line-clamp-1">
          {profile.headline}
        </p>
      </div>

      <div className="flex-1 space-y-5">
        <div className="bg-slate-950/40 rounded-3xl p-4 border border-white/5">
          <p className="text-[12px] text-slate-300 leading-relaxed line-clamp-4 font-medium italic">
            "{profile.about}"
          </p>
        </div>

        <div className="flex flex-wrap gap-2 justify-center">
          {profile.skills.slice(0, 5).map((skill, idx) => (
            <span key={idx} className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-tight border ${isCurrentUser ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300' : 'bg-white/5 border-white/10 text-slate-400'}`}>
              {skill}
            </span>
          ))}
        </div>

        {/* Citations/Sources from Search Grounding */}
        {profile.sources && profile.sources.length > 0 && (
          <div className="pt-2">
            <p className="text-[8px] font-black text-slate-600 uppercase tracking-widest mb-2 px-2">Verified via:</p>
            <div className="flex flex-wrap gap-2 px-2">
              {profile.sources.slice(0, 3).map((src, i) => (
                <a 
                  key={i} 
                  href={src.uri} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="text-[9px] text-indigo-500/80 hover:text-indigo-400 truncate max-w-[100px] border-b border-indigo-500/20"
                >
                  {src.title}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 pt-5 border-t border-white/5 flex justify-between items-center">
        <a 
          href={profile.linkedinUrl} 
          target="_blank" 
          rel="noopener noreferrer"
          className={`text-[10px] font-black transition-all uppercase tracking-[0.2em] ${isCurrentUser ? 'text-indigo-400 hover:text-indigo-200 hover:tracking-[0.3em]' : 'text-slate-500 hover:text-white'}`}
        >
          View Profile
        </a>
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${isCurrentUser ? 'bg-indigo-500 animate-pulse' : 'bg-slate-700'}`}></div>
          <span className="text-[9px] text-slate-600 font-black uppercase tracking-widest">
            {isCurrentUser ? 'ACTIVE NOW' : 'VERIFIED'}
          </span>
        </div>
      </div>
    </div>
  );
};
