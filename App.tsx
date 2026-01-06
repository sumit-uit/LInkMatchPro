
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Profile, NetworkingSynergy } from './types';
import { enrichProfile, analyzeRoomSynergies } from './services/geminiService';
import { dbService, supabase } from './services/supabaseService';
import { ProfileCard } from './components/ProfileCard';

/**
 * STRATEGY: FEATURE_FLAGS
 */
const FEATURE_FLAGS = {
  LINKPRO: true,
  RESUME_INTEL: false, 
  VISION_DECK: false,
  DIGITAL_TWIN: false
};

type AppRole = 'none' | 'host' | 'participant' | 'viewer';
type ViewState = 'hub' | 'linkmatch';

interface HistoryItem {
  code: string;
  name: string;
  timestamp: number;
  status?: string;
}

export default function App() {
  const [activeView, setActiveView] = useState<ViewState>('hub');
  const [user, setUser] = useState<any>(null);
  const [guestMode, setGuestMode] = useState(false);
  const [role, setRole] = useState<AppRole>('none');
  const [meetingCode, setMeetingCode] = useState('');
  const [meetingName, setMeetingName] = useState('');
  const [participants, setParticipants] = useState<Profile[]>([]);
  const [synergies, setSynergies] = useState<NetworkingSynergy[]>([]);
  const [loading, setLoading] = useState(false);
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const [isTestMode, setIsTestMode] = useState(false);
  const [isHydrating, setIsHydrating] = useState(true);
  const [hostHistory, setHostHistory] = useState<HistoryItem[]>([]);
  const [participantHistory, setParticipantHistory] = useState<HistoryItem[]>([]);
  const [copySuccess, setCopySuccess] = useState(false);

  const lastAnalyzedFingerprint = useRef("");

  /**
   * ROUTING & DEEP LINK HANDLING
   */
  useEffect(() => {
    const handleRoute = () => {
      const hash = window.location.hash;
      const params = new URLSearchParams(window.location.search);
      const roomParam = params.get('room');

      if (roomParam?.length === 6 && !hash.startsWith('#/app/linkpro')) {
        window.location.hash = '#/app/linkpro';
        return;
      }

      if (hash.startsWith('#/app/linkpro')) {
        setActiveView('linkmatch');
      } else {
        setActiveView('hub');
      }
    };

    handleRoute();
    window.addEventListener('hashchange', handleRoute);
    return () => window.removeEventListener('hashchange', handleRoute);
  }, []);

  const handleUserSession = useCallback(async (currentUser: any) => {
    try {
      setUser(currentUser);
      
      const params = new URLSearchParams(window.location.search);
      const roomFromUrl = params.get('room');
      const pendingRoom = sessionStorage.getItem('lm_pending_room');
      const finalRoom = pendingRoom || roomFromUrl;
      
      if (finalRoom?.length === 6) {
        setMeetingCode(finalRoom);
        if (pendingRoom) sessionStorage.removeItem('lm_pending_room');
      }

      if (currentUser) {
        setGuestMode(false);
        const pendingHash = sessionStorage.getItem('lm_pending_hash');
        if (pendingHash) {
          sessionStorage.removeItem('lm_pending_hash');
          window.location.hash = pendingHash;
        }

        let profile = await dbService.getProfile(currentUser.id);
        if (!profile) {
          const savedLocal = localStorage.getItem(`lm_profile_${currentUser.id}`);
          if (savedLocal) {
            try { profile = JSON.parse(savedLocal); } catch (e) {}
          }
        }

        if (!profile) {
          const metadata = currentUser.user_metadata;
          profile = {
            id: currentUser.id,
            name: metadata.full_name || metadata.name || currentUser.email?.split('@')[0] || "New Member",
            headline: "Identity Required",
            about: "Add your LinkedIn URL below to generate your professional card.",
            skills: [],
            interests: [],
            linkedinUrl: "", 
            imageUrl: metadata.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${currentUser.id}`,
            lastUpdated: Date.now()
          };
        }

        setMyProfile(profile);
        setLinkedinUrl(profile.linkedinUrl || '');
        refreshCloudHistory(currentUser.id);
      } else {
        const guestId = sessionStorage.getItem('lm_guest_id');
        if (guestId) {
          const savedGuest = localStorage.getItem(`lm_profile_${guestId}`);
          if (savedGuest) { try { setMyProfile(JSON.parse(savedGuest)); } catch (e) {} }
        }
      }
    } catch (e) {
      console.error("LinkPro: Session sync error", e);
    } finally {
      setIsHydrating(false);
    }
  }, []);

  useEffect(() => {
    const hydrationTimeout = setTimeout(() => {
      if (isHydrating) setIsHydrating(false);
    }, 2500);

    const init = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        await handleUserSession(session?.user ?? null);
      } catch (e) {
        setIsHydrating(false);
      }
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      handleUserSession(session?.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
      clearTimeout(hydrationTimeout);
    };
  }, [handleUserSession]);

  const refreshCloudHistory = async (userId: string) => {
    try {
      const [hosted, joined] = await Promise.all([
        dbService.getHostedMeetings(userId).catch(() => []), 
        dbService.getParticipatedMeetings(userId).catch(() => [])
      ]);
      setHostHistory(hosted);
      setParticipantHistory(joined);
    } catch (e) {}
  };

  useEffect(() => {
    let interval: number;
    if (activeView === 'linkmatch' && !isHydrating && meetingCode && role !== 'none' && !isTestMode) {
      const sync = async () => {
        const data = await dbService.getMeeting(meetingCode);
        if (data) {
          const currentUserId = user?.id || myProfile?.id;
          const currentParticipants = data.participants || [];
          setParticipants(currentParticipants);
          setMeetingName(data.name || '');
          if (String(data.hostId) === String(currentUserId)) {
            setRole('host');
          } else if (currentParticipants.some((p: any) => String(p.userId || p.id) === String(currentUserId))) {
            setRole('participant');
          }
        }
      };
      sync();
      interval = window.setInterval(sync, 4000);
    }
    return () => clearInterval(interval);
  }, [meetingCode, isTestMode, user, myProfile, activeView, isHydrating, role]);

  useEffect(() => {
    if (activeView !== 'linkmatch' || isTestMode || isHydrating || role === 'none') return;
    const participantFingerprint = participants.map(p => p.id).sort().join(",");
    if (participants.length >= 2 && !isAnalyzing && participantFingerprint !== lastAnalyzedFingerprint.current) {
      const runAI = async () => {
        setIsAnalyzing(true);
        try {
          const results = await analyzeRoomSynergies(participants);
          setSynergies(results);
          lastAnalyzedFingerprint.current = participantFingerprint;
        } catch (e) {} finally { setIsAnalyzing(false); }
      };
      runAI();
    }
  }, [participants, isAnalyzing, isTestMode, activeView, isHydrating, role]);

  const handleLinkLinkedInProfile = async () => {
    if (!linkedinUrl.trim()) return alert("Please enter a LinkedIn URL");
    if (!linkedinUrl.includes('linkedin.com/in/')) return alert("Invalid LinkedIn URL");
    setLoading(true);
    try {
      const profile = await enrichProfile(linkedinUrl);
      const userId = user?.id || myProfile?.id || profile.id;
      const finalProfile = { ...profile, id: userId };
      setMyProfile(finalProfile);
      if (user) {
        localStorage.setItem(`lm_profile_${user.id}`, JSON.stringify(finalProfile));
        await dbService.upsertProfile(user.id, finalProfile);
      }
      if (meetingCode && role !== 'none') {
        await dbService.joinMeeting(meetingCode, finalProfile, userId);
      }
    } catch (e: any) {
      alert("Profile enrichment failed. Please check your URL.");
    } finally { setLoading(false); }
  };

  const handleHostCreate = async () => {
    if (!user) return alert("Please sign in to host a board.");
    if (!myProfile?.linkedinUrl) return alert("Complete your Identity Card first.");
    if (!meetingName.trim()) return alert("Please name your board.");
    setLoading(true);
    try {
      const code = await dbService.createMeeting(meetingName, user.id);
      setMeetingCode(code);
      setRole('host');
      if (myProfile) await dbService.joinMeeting(code, { ...myProfile, id: user.id }, user.id);
      await refreshCloudHistory(user.id);
    } catch (e: any) {
      alert("Failed to create board.");
    } finally { setLoading(false); }
  };

  const handleJoinRoom = async (codeOverride?: string) => {
    const targetCode = codeOverride || meetingCode;
    if (!targetCode || targetCode.length !== 6) return alert("Invalid code format");
    
    // MANDATORY IDENTITY CHECK
    if (!myProfile || !myProfile.linkedinUrl) {
      return alert("Professional Identity Required. Please enter and sync your LinkedIn URL in the Identity Card before joining the terminal.");
    }

    setLoading(true);
    try {
      const userId = user?.id || myProfile.id;
      await dbService.joinMeeting(targetCode, { ...myProfile, id: userId }, userId);
      const roomData = await dbService.getMeeting(targetCode);
      if (!roomData) throw new Error("Terminal not found.");
      
      setMeetingCode(targetCode);
      setMeetingName(roomData.name || 'Networking Board');
      setRole(String(roomData.hostId) === String(userId) ? 'host' : 'participant'); 
      
      const url = new URL(window.location.href);
      url.searchParams.set('room', targetCode);
      window.history.replaceState({}, '', url);
    } catch (e: any) { alert(e.message); } finally { setLoading(false); }
  };

  const handleDeleteMeeting = async (codeOverride?: string) => {
    const targetCode = codeOverride || meetingCode;
    const confirmMsg = "CRITICAL: You are the OWNER of this terminal. Destroying it will disconnect ALL participants and permanently erase the board. Are you absolutely sure you want to delete this room?";
    if (!confirm(confirmMsg)) return;
    
    setLoading(true);
    try {
      await dbService.deleteMeeting(targetCode, user.id);
      if (targetCode === meetingCode) exitRoom();
      if (user) await refreshCloudHistory(user.id);
    } catch (e: any) {
      alert(e.message);
    } finally { setLoading(false); }
  };

  const handleLeaveMeeting = async (code: string) => {
    const confirmMsg = "LEAVE TERMINAL: Your professional card will be removed from this board immediately and it will disappear from your history. You will need the code to reconnect later. Confirm leave?";
    if (!confirm(confirmMsg)) return;

    setLoading(true);
    try {
      const userId = user?.id || myProfile?.id;
      if (!userId) throw new Error("Not logged in");
      await dbService.removeParticipant(code, userId);
      if (user) await refreshCloudHistory(user.id);
    } catch (e: any) {
      alert(e.message);
    } finally { setLoading(false); }
  };

  const copyInviteLink = () => {
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('room', meetingCode);
    navigator.clipboard.writeText(url.toString());
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const exitRoom = () => {
    setRole('none');
    setParticipants([]);
    setSynergies([]);
    setIsTestMode(false);
    lastAnalyzedFingerprint.current = "";
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url);
  };

  const navigateToHub = () => {
    window.location.hash = '';
    setActiveView('hub');
  };

  const launchLinkPro = () => {
    window.location.hash = '/app/linkpro';
    setActiveView('linkmatch');
  };

  if (activeView === 'hub') {
    return (
      <div className="min-h-screen bg-[#020617] text-white font-inter selection:bg-indigo-500/30 overflow-x-hidden">
        <div className="fixed inset-0 pointer-events-none">
          <div className="absolute top-[-20%] left-[-10%] w-[70%] h-[70%] bg-indigo-600/10 blur-[150px] rounded-full"></div>
          <div className="absolute bottom-[-20%] right-[-10%] w-[70%] h-[70%] bg-purple-600/10 blur-[150px] rounded-full"></div>
          <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 brightness-50 contrast-150"></div>
        </div>

        <div className="max-w-7xl mx-auto px-8 py-12 relative z-10">
          <header className="flex justify-between items-center mb-40">
            <div className="flex items-center gap-5">
              <div className="w-14 h-14 bg-white rounded-[1.8rem] flex items-center justify-center font-black text-black text-2xl shadow-[0_0_50px_rgba(255,255,255,0.15)]">T</div>
              <div>
                <h1 className="text-3xl font-black tracking-tighter uppercase leading-none">TechAIPro</h1>
                <p className="text-[9px] font-black text-indigo-400 uppercase tracking-[0.4em] mt-2">Professional Ecosystem</p>
              </div>
            </div>
            <div className="flex items-center gap-8">
              {user ? (
                <div className="flex items-center gap-4 bg-slate-900/40 backdrop-blur-3xl border border-white/5 pl-2 pr-6 py-2 rounded-full shadow-2xl">
                  <img src={user.user_metadata.avatar_url} className="w-11 h-11 rounded-full border-2 border-indigo-500/40" alt="" />
                  <div className="flex flex-col">
                    <p className="text-sm font-black text-white">{user.user_metadata.full_name}</p>
                    <button onClick={() => dbService.signOut()} className="text-[9px] font-black uppercase text-indigo-400 tracking-widest text-left hover:text-white transition-colors mt-1">Sign Out</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => dbService.signInWithLinkedIn()} className="px-10 py-4 bg-white text-black rounded-full text-[11px] font-black uppercase tracking-[0.2em] hover:scale-105 active:scale-95 transition-all shadow-2xl hover:shadow-white/10">Launch Identity</button>
              )}
            </div>
          </header>

          <main className="space-y-32">
            <div className="max-w-4xl">
              <span className="inline-block px-5 py-2 bg-indigo-600/10 border border-indigo-500/20 rounded-full text-indigo-400 font-black text-[10px] uppercase tracking-[0.4em] mb-10">Intelligence Terminal v2.5</span>
              <h2 className="text-[5.5rem] font-black tracking-tighter leading-[0.85] mb-12">
                Elevate your <br />
                <span className="text-slate-600">Professional Edge.</span>
              </h2>
              <p className="text-xl text-slate-400 max-w-2xl leading-relaxed font-medium">
                TechAIPro is the command center for the modern executive. Seamlessly bridge your digital presence with physical networking using our suite of proprietary AI tools.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
              {FEATURE_FLAGS.LINKPRO && (
                <div 
                  onClick={launchLinkPro}
                  className="group relative h-[500px] bg-slate-900/60 backdrop-blur-md border border-white/5 rounded-[4rem] p-12 flex flex-col justify-between cursor-pointer hover:border-white/20 hover:bg-slate-900/80 transition-all duration-500 overflow-hidden shadow-2xl"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                  <div>
                    <div className="w-20 h-20 bg-indigo-600 rounded-[2rem] flex items-center justify-center font-black text-3xl shadow-[0_0_40px_rgba(79,70,229,0.3)] group-hover:scale-110 transition-transform duration-700">LP</div>
                    <h3 className="mt-10 text-4xl font-black tracking-tight">LinkPro</h3>
                    <p className="mt-6 text-slate-400 leading-relaxed text-base font-medium">
                      Real-time networking intelligence. Generate dynamic professional cards, find board-wide synergies, and automate follow-ups with Gemini AI.
                    </p>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">Status</span>
                      <span className="text-xs font-black text-white uppercase tracking-widest">Operational</span>
                    </div>
                    <div className="w-14 h-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center group-hover:bg-white group-hover:text-black transition-all duration-500">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    );
  }

  if (activeView === 'linkmatch') {
    if (isHydrating) {
      return (
        <div className="min-h-screen bg-[#020617] flex flex-col items-center justify-center gap-6">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.3em] animate-pulse">Synchronizing Identity Data</p>
        </div>
      );
    }

    if (!user && !guestMode && role === 'none') {
      return (
        <div className="min-h-screen bg-[#020617] text-white flex flex-col items-center justify-center p-6 font-inter">
          <div className="max-w-md w-full text-center space-y-12 animate-in">
            <div className="w-24 h-24 bg-indigo-600 rounded-[2.5rem] flex items-center justify-center font-black text-4xl mx-auto shadow-2xl rotate-6">LP</div>
            <div>
              <h1 className="text-5xl font-black tracking-tight mb-4">LinkPro</h1>
              <p className="text-slate-500 text-lg">AI Networking Intelligence</p>
            </div>
            <div className="space-y-4">
              <button onClick={() => dbService.signInWithLinkedIn()} className="w-full bg-[#0077b5] py-5 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-[#00669c] transition-all flex items-center justify-center gap-4 shadow-xl">Sign in with LinkedIn</button>
              <button onClick={() => setGuestMode(true)} className="w-full bg-slate-900 text-slate-400 py-5 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-800 transition-all border border-white/5">Use as Guest</button>
              <div className="pt-6">
                 <button onClick={navigateToHub} className="text-slate-600 hover:text-white transition-all text-[10px] font-black uppercase tracking-[0.3em] flex items-center justify-center gap-3 mx-auto">
                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                   Back to TechAIPro Hub
                 </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (role === 'none') {
      const isProfileSynced = !!myProfile?.linkedinUrl;
      const filteredParticipantHistory = participantHistory.filter(
        p => !hostHistory.some(h => h.code === p.code)
      );

      return (
        <div className="min-h-screen bg-[#020617] text-white p-12 font-inter">
          <div className="max-w-7xl mx-auto">
            <header className="flex justify-between items-center mb-24">
              <div className="flex items-center gap-6">
                <button onClick={navigateToHub} className="w-14 h-14 bg-white/5 text-slate-400 rounded-2xl flex items-center justify-center hover:bg-white hover:text-black transition-all shadow-xl border border-white/10 group">
                   <svg className="w-6 h-6 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M4 12h16M4 18h16" /></svg>
                </button>
                <div>
                  <h1 className="text-2xl font-black tracking-tighter">Command Center</h1>
                  <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mt-1">Networking Dashboard</p>
                </div>
              </div>

              <div className="flex items-center gap-6 bg-slate-900/60 p-2 pr-8 rounded-full border border-white/5 shadow-2xl">
                {user ? (
                  <>
                    <img src={user.user_metadata.avatar_url} className="w-10 h-10 rounded-full border-2 border-indigo-500/30" alt="" />
                    <button onClick={() => dbService.signOut()} className="text-[10px] font-black text-slate-500 uppercase tracking-widest hover:text-red-400 transition-colors">Sign Out</button>
                  </>
                ) : (
                  <button onClick={() => setGuestMode(false)} className="px-8 py-2.5 bg-white text-black rounded-full text-[10px] font-black uppercase tracking-widest">Connect Session</button>
                )}
              </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-20">
              <div className="lg:col-span-4 space-y-12">
                <div className="p-10 rounded-[3.5rem] border-2 bg-slate-900/50 border-white/5 shadow-2xl relative overflow-hidden backdrop-blur-xl">
                  <h2 className="text-xl font-black mb-8">Identity Card</h2>
                  {myProfile && (
                    <div className="flex items-center gap-6 mb-10 animate-in">
                      <img src={myProfile.imageUrl} className="w-20 h-20 rounded-[2rem] border-2 border-indigo-500/30 shadow-2xl" alt="" />
                      <div className="overflow-hidden">
                        <p className="text-xl font-black truncate text-white">{myProfile.name}</p>
                        <p className="text-[11px] text-indigo-400 truncate mt-1 uppercase font-black tracking-widest">{myProfile.headline}</p>
                      </div>
                    </div>
                  )}
                  <div className="space-y-5">
                    <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest px-1">LinkedIn URL</p>
                    <input placeholder="linkedin.com/in/username" className="w-full bg-slate-950/60 border border-slate-800 rounded-2xl px-8 py-6 text-sm outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all text-slate-200" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} />
                    <button onClick={handleLinkLinkedInProfile} disabled={loading} className={`w-full py-6 rounded-2xl font-black text-xs uppercase tracking-[0.3em] transition-all shadow-2xl ${loading ? 'bg-indigo-900 text-indigo-400 animate-pulse' : 'bg-white text-black hover:bg-slate-200 active:scale-95'}`}>{loading ? 'Syncing...' : 'Sync Identity'}</button>
                  </div>
                </div>

                <div className="bg-slate-900/20 border border-white/5 p-10 rounded-[3rem] space-y-8 backdrop-blur-md">
                  <h2 className="text-xl font-black tracking-tight">Terminal Control</h2>
                  
                  {!isProfileSynced && (
                    <div className="p-6 bg-amber-500/10 border border-amber-500/20 rounded-3xl animate-in">
                      <p className="text-[10px] text-amber-500 font-black uppercase tracking-widest leading-relaxed">
                        ⚠️ Identity Required: You must sync your professional identity before connecting to any terminals.
                      </p>
                    </div>
                  )}

                  <div className="space-y-5">
                    <div className="p-8 bg-slate-950/40 rounded-[2.8rem] border border-white/5">
                      <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-6 px-1">Initialize New Board</p>
                      <input placeholder="Terminal Name" className="w-full bg-slate-900/60 border border-slate-800 rounded-2xl px-6 py-5 text-sm outline-none mb-5 focus:ring-2 focus:ring-indigo-500/40" value={meetingName} onChange={(e) => setMeetingName(e.target.value)} />
                      <button 
                        onClick={handleHostCreate} 
                        disabled={loading || !isProfileSynced} 
                        className="w-full bg-indigo-600 py-5 rounded-2xl font-black text-[10px] uppercase tracking-[0.3em] hover:bg-indigo-500 disabled:opacity-30 disabled:grayscale shadow-xl shadow-indigo-600/20 active:scale-95 transition-all"
                      >
                        Create Terminal
                      </button>
                    </div>
                    <div className="p-8 bg-emerald-500/5 rounded-[2.8rem] border border-emerald-500/10">
                      <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-6 px-1">Connect to Existing</p>
                      
                      {meetingCode.length === 6 && (
                        <div className="mb-4 bg-indigo-600/10 p-3 rounded-xl border border-indigo-500/20 flex items-center gap-3">
                           <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></div>
                           <p className="text-[9px] font-black text-indigo-300 uppercase tracking-widest">Target Locked</p>
                        </div>
                      )}

                      <input placeholder="000 000" className="w-full bg-slate-900/60 border border-slate-800 rounded-2xl px-6 py-5 text-center text-2xl font-black tracking-[0.5em] mb-5 outline-none focus:ring-2 focus:ring-emerald-500/40" value={meetingCode} maxLength={6} onChange={(e) => setMeetingCode(e.target.value.replace(/\D/g, ''))} />
                      <button 
                        onClick={() => handleJoinRoom()} 
                        disabled={loading || !isProfileSynced} 
                        className="w-full bg-emerald-600 py-5 rounded-2xl font-black text-[10px] uppercase tracking-[0.3em] hover:bg-emerald-500 disabled:opacity-30 disabled:grayscale active:scale-95 transition-all"
                      >
                        Link To Terminal
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-8 space-y-16">
                {user ? (
                  <div className="space-y-20">
                    {/* COMMANDED TERMINALS SECTION */}
                    <section className="animate-in" style={{ animationDelay: '100ms' }}>
                      <h3 className="text-[11px] font-black text-indigo-400 uppercase tracking-[0.4em] mb-10 px-4 flex items-center gap-4">
                        Commanded Terminals
                        <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                        <span className="text-slate-700 normal-case tracking-normal">({hostHistory.length})</span>
                      </h3>
                      {hostHistory.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                          {hostHistory.map(h => (
                            <div key={h.code} className="group relative">
                              <button onClick={() => handleJoinRoom(h.code)} className="w-full p-10 bg-slate-900/40 border border-white/5 rounded-[3rem] hover:border-indigo-500/40 hover:bg-slate-900/60 transition-all text-left shadow-xl overflow-hidden">
                                <span className="inline-block px-3 py-1 bg-indigo-600/20 text-indigo-400 text-[8px] font-black uppercase tracking-widest rounded-lg mb-4 border border-indigo-500/20">OWNER / HOST</span>
                                <p className="text-2xl font-black group-hover:text-white transition-colors line-clamp-1 pr-10">{h.name}</p>
                                <div className="flex items-center gap-4 mt-6">
                                  <span className="text-[10px] bg-slate-950/60 px-3 py-1.5 rounded-lg text-indigo-400 font-black uppercase tracking-widest border border-white/5">CODE: {h.code}</span>
                                  <span className="text-[10px] text-slate-600 font-black uppercase tracking-widest">{new Date(h.timestamp).toLocaleDateString()}</span>
                                </div>
                              </button>
                              <button 
                                onClick={(e) => { e.stopPropagation(); handleDeleteMeeting(h.code); }}
                                className="absolute top-8 right-8 p-3 bg-red-500/10 text-red-500 rounded-2xl border border-red-500/20 hover:bg-red-500 hover:text-white transition-all opacity-0 group-hover:opacity-100 shadow-2xl"
                                title="Destroy Terminal"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-16 border-2 border-dashed border-white/5 rounded-[3.5rem] text-center bg-slate-900/20">
                          <p className="text-[11px] text-slate-600 font-black uppercase tracking-widest">No terminals initialized yet.</p>
                        </div>
                      )}
                    </section>

                    {/* CONNECTED TERMINALS SECTION */}
                    <section className="animate-in" style={{ animationDelay: '200ms' }}>
                      <h3 className="text-[11px] font-black text-emerald-400 uppercase tracking-[0.4em] mb-10 px-4 flex items-center gap-4">
                        Connected Terminals
                        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                        <span className="text-slate-700 normal-case tracking-normal">({filteredParticipantHistory.length})</span>
                      </h3>
                      {filteredParticipantHistory.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                          {filteredParticipantHistory.map(h => (
                            <div key={h.code} className="group relative">
                              <button onClick={() => handleJoinRoom(h.code)} className="w-full p-10 bg-slate-900/40 border border-white/5 rounded-[3rem] hover:border-emerald-500/40 hover:bg-slate-900/60 transition-all text-left shadow-xl overflow-hidden">
                                <span className="inline-block px-3 py-1 bg-emerald-600/20 text-emerald-400 text-[8px] font-black uppercase tracking-widest rounded-lg mb-4 border border-emerald-500/20">MEMBER ONLY</span>
                                <p className="text-2xl font-black group-hover:text-white transition-colors line-clamp-1 pr-10">{h.name}</p>
                                <div className="flex items-center gap-4 mt-6">
                                  <span className="text-[10px] bg-slate-950/60 px-3 py-1.5 rounded-lg text-emerald-400 font-black uppercase tracking-widest border border-white/5">CODE: {h.code}</span>
                                  <span className="text-[10px] text-slate-600 font-black uppercase tracking-widest">{new Date(h.timestamp).toLocaleDateString()}</span>
                                </div>
                              </button>
                              <button 
                                onClick={(e) => { e.stopPropagation(); handleLeaveMeeting(h.code); }}
                                className="absolute top-8 right-8 p-3 bg-emerald-500/10 text-emerald-500 rounded-2xl border border-emerald-500/20 hover:bg-emerald-500 hover:text-white transition-all opacity-0 group-hover:opacity-100 shadow-2xl"
                                title="Forget Terminal"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-16 border-2 border-dashed border-white/5 rounded-[3.5rem] text-center bg-slate-900/20">
                          <p className="text-[11px] text-slate-600 font-black uppercase tracking-widest">No external connections found.</p>
                        </div>
                      )}
                    </section>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center p-20 border-2 border-dashed border-white/5 rounded-[4rem] bg-slate-900/10">
                    <div className="text-center">
                       <svg className="w-16 h-16 text-slate-800 mx-auto mb-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                       <p className="text-[11px] text-slate-600 font-black uppercase tracking-widest">Synchronized Cloud Access Required</p>
                       <button onClick={() => dbService.signInWithLinkedIn()} className="mt-8 px-10 py-4 bg-white text-black rounded-full text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-transform">Initialize Cloud Sync</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    const personalMatches = synergies.filter(s => myProfile && s.pair.map(String).includes(String(myProfile.id)));
    const roomSynergies = synergies.filter(s => myProfile && !s.pair.map(String).includes(String(myProfile.id)));
    const participantScores = {} as any;
    participants.forEach(p => {
      if (myProfile && String(p.id) === String(myProfile.id)) { participantScores[p.id] = 100; return; }
      const syn = synergies.find(s => myProfile && s.pair.map(String).includes(String(myProfile.id)) && s.pair.map(String).includes(String(p.id)));
      if (syn) participantScores[p.id] = syn.strength;
    });

    return (
      <div className="min-h-screen bg-[#020617] text-slate-100 flex flex-col font-inter">
        <header className="border-b border-white/5 bg-slate-900/80 backdrop-blur-3xl px-12 py-10 flex justify-between items-center sticky top-0 z-50">
          <div className="flex items-center gap-10">
            <button onClick={navigateToHub} className="w-16 h-16 bg-white text-black rounded-[2rem] flex items-center justify-center font-black shadow-lg shadow-white/10 hover:scale-105 transition-transform">T</button>
            <div>
              <h1 className="text-3xl font-black tracking-tighter truncate max-w-[400px]">{meetingName}</h1>
              <div className="flex items-center gap-4 mt-2">
                <span className="px-4 py-1.5 bg-indigo-600/20 text-indigo-400 rounded-full text-[9px] font-black uppercase tracking-[0.2em] border border-indigo-500/20">Active Board</span>
                <span className="text-slate-800 font-black text-[11px]">/</span>
                <button onClick={copyInviteLink} className="group flex items-center gap-2 text-slate-500 hover:text-indigo-400 transition-all">
                  <p className="font-black text-[11px] uppercase tracking-widest">TERMINAL: {meetingCode}</p>
                  <svg className={`w-3.5 h-3.5 transition-all ${copySuccess ? 'scale-125 text-emerald-400' : 'group-hover:scale-110'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {copySuccess ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2" />
                    )}
                  </svg>
                </button>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
             <button onClick={copyInviteLink} className={`flex items-center gap-3 px-6 py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all border ${copySuccess ? 'bg-emerald-500 text-white border-emerald-400' : 'bg-white text-black border-white hover:bg-slate-200'}`}>
               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
               {copySuccess ? 'Link Copied' : 'Invite Members'}
             </button>
             {role === 'host' && (
               <button onClick={() => handleDeleteMeeting()} disabled={loading} className="px-6 py-3.5 bg-red-500/10 text-red-500 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] border border-red-500/20 hover:bg-red-500 hover:text-white transition-all disabled:opacity-30">
                 {loading ? 'Destroying...' : 'Destroy Terminal'}
               </button>
             )}
             <button onClick={exitRoom} className="px-6 py-3.5 bg-slate-800/40 text-slate-400 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] border border-white/5 hover:bg-slate-700 hover:text-white transition-all">Disconnect</button>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          <main className="flex-1 overflow-y-auto p-16 scrollbar-hide">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-12">
              {participants.map((p) => (
                <ProfileCard 
                  key={p.id} 
                  profile={p} 
                  isCurrentUser={String(p.id) === String(myProfile?.id)}
                  matchScore={participantScores[p.id]}
                  canDelete={role === 'host' || String(p.id) === String(myProfile?.id)}
                  onDelete={(id) => dbService.removeParticipant(meetingCode, id)}
                  isAnalyzing={isAnalyzing && String(p.id) !== String(myProfile?.id)}
                />
              ))}
            </div>
          </main>
          <aside className="w-[450px] border-l border-white/5 bg-slate-900/40 p-16 overflow-y-auto scrollbar-hide hidden lg:block backdrop-blur-md">
            <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.4em] mb-12">Gemini Analysis</h3>
            <div className="space-y-16">
              {personalMatches.length > 0 && (
                <div>
                  <p className="text-[10px] font-black text-indigo-400 uppercase mb-6 tracking-widest px-1">Your Prime Connections</p>
                  {personalMatches.map((syn, idx) => (
                    <div key={idx} className="bg-indigo-600/10 border border-indigo-500/20 rounded-[2.5rem] p-8 mb-6 shadow-2xl animate-in">
                      <p className="text-white text-base font-black mb-3">{syn.topic}</p>
                      <p className="text-slate-400 text-sm leading-relaxed italic">"{syn.reason}"</p>
                    </div>
                  ))}
                </div>
              )}
              <div>
                <p className="text-[10px] font-black text-slate-600 uppercase mb-6 tracking-widest px-1">Terminal Dynamics</p>
                {roomSynergies.length > 0 ? roomSynergies.map((syn, idx) => (
                  <div key={idx} className="bg-slate-800/40 border border-white/5 rounded-[2.5rem] p-8 mb-6">
                    <p className="text-slate-300 text-sm font-bold mb-3">{syn.topic}</p>
                    <p className="text-slate-500 text-xs leading-relaxed">{syn.reason}</p>
                  </div>
                )) : (
                  <div className="p-10 border-2 border-dashed border-white/5 rounded-[2.5rem] text-center">
                    <p className="text-[10px] text-slate-700 font-black uppercase tracking-widest leading-loose">Awaiting sufficient participant density...</p>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    );
  }

  return null;
}
