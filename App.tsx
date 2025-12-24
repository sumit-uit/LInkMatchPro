
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Profile, NetworkingSynergy } from './types';
import { enrichProfile, analyzeRoomSynergies } from './services/geminiService';
import { dbService, supabase } from './services/supabaseService';
import { ProfileCard } from './components/ProfileCard';

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

  useEffect(() => {
    const handleRoute = () => {
      const hash = window.location.hash;
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
      if (currentUser) {
        setGuestMode(false);

        const pendingHash = sessionStorage.getItem('lm_pending_hash');
        if (pendingHash) {
          sessionStorage.removeItem('lm_pending_hash');
          window.location.hash = pendingHash;
        }

        const pendingRoom = sessionStorage.getItem('lm_pending_room');
        if (pendingRoom) {
          sessionStorage.removeItem('lm_pending_room');
          setMeetingCode(pendingRoom);
          const url = new URL(window.location.href);
          url.searchParams.set('room', pendingRoom);
          window.history.replaceState({}, '', url);
        }

        let profile: Profile | null = null;
        const savedProfile = localStorage.getItem(`lm_profile_${currentUser.id}`);
        if (savedProfile) { try { profile = JSON.parse(savedProfile); } catch (e) {} }
        
        if (!profile) {
          const metadata = currentUser.user_metadata;
          profile = {
            id: currentUser.id,
            name: metadata.full_name || metadata.name || currentUser.email?.split('@')[0] || "New Member",
            headline: "Ready to network",
            about: "Add your LinkedIn URL below to generate your professional card.",
            skills: [],
            interests: [],
            linkedinUrl: "", 
            imageUrl: metadata.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${currentUser.id}`,
            lastUpdated: Date.now()
          };
          localStorage.setItem(`lm_profile_${currentUser.id}`, JSON.stringify(profile));
        }
        setMyProfile(profile);
        setLinkedinUrl(profile.linkedinUrl || '');
        
        const params = new URLSearchParams(window.location.search);
        const room = params.get('room');
        if (room?.length === 6) {
          setMeetingCode(room);
          if (window.location.hash !== '#/app/linkpro') {
            window.location.hash = '#/app/linkpro';
          }
        }
        refreshCloudHistory(currentUser.id);
      } else {
        const guestId = sessionStorage.getItem('lm_guest_id');
        if (guestId) {
          const savedGuest = localStorage.getItem(`lm_profile_${guestId}`);
          if (savedGuest) { try { setMyProfile(JSON.parse(savedGuest)); } catch (e) {} }
        }
        setRole('none');
      }
    } catch (e) {} finally { setIsHydrating(false); }
  }, []);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      await handleUserSession(session?.user ?? null);
    };
    init();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => handleUserSession(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, [handleUserSession]);

  const refreshCloudHistory = async (userId: string) => {
    try {
      const [hosted, joined] = await Promise.all([
        dbService.getHostedMeetings(userId), 
        dbService.getParticipatedMeetings(userId)
      ]);
      setHostHistory(hosted);
      setParticipantHistory(joined);
    } catch (e) {}
  };

  useEffect(() => {
    let interval: number;
    if (activeView === 'linkmatch' && role !== 'none' && meetingCode && !isTestMode) {
      const sync = async () => {
        const data = await dbService.getMeeting(meetingCode);
        if (data) {
          const currentUserId = user?.id || myProfile?.id;
          const currentParticipants = data.participants || [];
          const stillActive = currentParticipants.some((p: any) => String(p.userId || p.id) === String(currentUserId));
          
          if (!stillActive && role !== 'host') {
            exitRoom();
            alert("The host has removed you from this board.");
            return;
          }

          setParticipants(currentParticipants);
          setMeetingName(data.name || '');
          if (String(data.hostId) === String(currentUserId)) setRole('host');
          else setRole('participant');
        } else {
          exitRoom();
          alert("This board no longer exists.");
        }
      };
      sync();
      interval = window.setInterval(sync, 4000);
    }
    return () => clearInterval(interval);
  }, [role, meetingCode, isTestMode, user, myProfile, activeView]);

  useEffect(() => {
    if (activeView !== 'linkmatch' || isTestMode) return;
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
  }, [participants, isAnalyzing, isTestMode, activeView]);

  const handleLinkLinkedInProfile = async () => {
    if (!linkedinUrl.trim()) return alert("Please enter a LinkedIn URL");
    if (!linkedinUrl.includes('linkedin.com/in/')) return alert("Invalid LinkedIn URL");
    setLoading(true);
    try {
      const profile = await enrichProfile(linkedinUrl);
      const userId = user?.id || myProfile?.id || profile.id;
      const finalProfile = { ...profile, id: userId };
      setMyProfile(finalProfile);
      if (user) localStorage.setItem(`lm_profile_${user.id}`, JSON.stringify(finalProfile));
      if (meetingCode && role !== 'none') await dbService.joinMeeting(meetingCode, finalProfile, userId);
    } catch (e: any) {
      alert("Failed to research profile: " + e.message);
    } finally { setLoading(false); }
  };

  const handleHostCreate = async () => {
    if (!user) return alert("Please sign in to host a board.");
    if (!meetingName.trim()) return alert("Please name your board first.");
    setLoading(true);
    try {
      const code = await dbService.createMeeting(meetingName, user.id);
      setMeetingCode(code);
      setRole('host');
      if (myProfile) await dbService.joinMeeting(code, { ...myProfile, id: user.id }, user.id);
      await refreshCloudHistory(user.id);
    } catch (e: any) {
      alert("Host failed: " + e.message);
    } finally { setLoading(false); }
  };

  const handleJoinRoom = async (codeOverride?: string) => {
    const targetCode = codeOverride || meetingCode;
    if (!targetCode || targetCode.length !== 6) return alert("Invalid code");
    if (!myProfile) return alert("Build profile first");
    setLoading(true);
    try {
      const userId = user?.id || myProfile.id;
      await dbService.joinMeeting(targetCode, { ...myProfile, id: userId }, userId);
      const roomData = await dbService.getMeeting(targetCode);
      if (!roomData) throw new Error("Room not found.");
      setMeetingCode(targetCode);
      setMeetingName(roomData.name || 'Live Board');
      setRole(String(roomData.hostId) === String(userId) ? 'host' : 'participant'); 
      const url = new URL(window.location.href);
      url.searchParams.set('room', targetCode);
      window.history.replaceState({}, '', url);
    } catch (e: any) { alert(e.message); } finally { setLoading(false); }
  };

  const handleDeleteMeeting = async () => {
    if (!confirm("Are you sure you want to PERMANENTLY delete this meeting terminal and all its data?")) return;
    setLoading(true);
    try {
      await dbService.deleteMeeting(meetingCode, user.id);
      exitRoom();
      if (user) refreshCloudHistory(user.id);
    } catch (e: any) {
      alert("Delete failed: " + e.message);
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
                <div className="flex items-center gap-4 bg-slate-900/40 backdrop-blur-3xl border border-white/5 pl-2 pr-8 py-2 rounded-full shadow-2xl">
                  <img src={user.user_metadata.avatar_url} className="w-11 h-11 rounded-full border-2 border-indigo-500/40" alt="" />
                  <div>
                    <p className="text-[9px] font-black uppercase text-slate-500 tracking-widest">Active Pilot</p>
                    <p className="text-sm font-black text-white">{user.user_metadata.full_name}</p>
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

              <div className="relative h-[500px] bg-slate-900/10 border border-white/5 rounded-[4rem] p-12 flex flex-col justify-between grayscale opacity-30 contrast-75 overflow-hidden cursor-not-allowed">
                <div>
                  <div className="w-20 h-20 bg-slate-800 rounded-[2rem] flex items-center justify-center font-black text-3xl text-slate-600">RI</div>
                  <h3 className="mt-10 text-4xl font-black tracking-tight text-slate-500">Resume Intel</h3>
                  <p className="mt-6 text-slate-600 leading-relaxed text-base font-medium">
                    Optimize your career narrative with AI-driven scoring and keyword targeting for modern ATS systems.
                  </p>
                </div>
                <span className="px-6 py-2 bg-slate-800 text-slate-500 rounded-full text-[10px] font-black uppercase tracking-widest self-start">Coming Soon</span>
              </div>

              <div className="relative h-[500px] bg-slate-900/10 border border-white/5 rounded-[4rem] p-12 flex flex-col justify-between grayscale opacity-30 contrast-75 overflow-hidden cursor-not-allowed">
                <div>
                  <div className="w-20 h-20 bg-slate-800 rounded-[2rem] flex items-center justify-center font-black text-3xl text-slate-600">VD</div>
                  <h3 className="mt-10 text-4xl font-black tracking-tight text-slate-500">Vision Deck</h3>
                  <p className="mt-6 text-slate-600 leading-relaxed text-base font-medium">
                    A collaborative virtual canvas for founders to build technical roadmaps with real-time AI architectural feedback.
                  </p>
                </div>
                <span className="px-6 py-2 bg-slate-800 text-slate-500 rounded-full text-[10px] font-black uppercase tracking-widest self-start">Planned</span>
              </div>
            </div>
          </main>

          <footer className="mt-48 pt-16 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-12 text-slate-600">
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-black uppercase tracking-[0.4em]">© 2025 TechAIPro Corporation</p>
            </div>
            <div className="flex flex-col items-end gap-2 text-right">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-700">Environment Deployment</p>
              <p className="text-[10px] font-medium font-mono text-indigo-500/50">{window.location.origin}</p>
            </div>
          </footer>
        </div>
      </div>
    );
  }

  if (activeView === 'linkmatch') {
    if (isHydrating) {
      return (
        <div className="min-h-screen bg-[#020617] flex flex-col items-center justify-center gap-6">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.3em] animate-pulse">Initializing LinkPro Environment</p>
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
                  <button onClick={() => setGuestMode(false)} className="px-8 py-2.5 bg-white text-black rounded-full text-[10px] font-black uppercase tracking-widest">Connect</button>
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
                    <input placeholder="linkedin.com/in/username" className="w-full bg-slate-950/60 border border-slate-800 rounded-2xl px-8 py-6 text-sm outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all text-slate-200" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} />
                    <button onClick={handleLinkLinkedInProfile} disabled={loading} className={`w-full py-6 rounded-2xl font-black text-xs uppercase tracking-[0.3em] transition-all shadow-2xl ${loading ? 'bg-indigo-900 text-indigo-400 animate-pulse' : 'bg-white text-black hover:bg-slate-200 active:scale-95'}`}>{loading ? 'Researching...' : 'Sync Profile'}</button>
                  </div>
                </div>

                <div className="bg-slate-900/20 border border-white/5 p-10 rounded-[3rem] space-y-8 backdrop-blur-md">
                  <h2 className="text-xl font-black tracking-tight">Board Management</h2>
                  <div className="space-y-5">
                    <div className="p-8 bg-slate-950/40 rounded-[2.8rem] border border-white/5">
                      <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-6 px-1">Host Event</p>
                      <input placeholder="Board Title" className="w-full bg-slate-900/60 border border-slate-800 rounded-2xl px-6 py-5 text-sm outline-none mb-5 focus:ring-2 focus:ring-indigo-500/40" value={meetingName} onChange={(e) => setMeetingName(e.target.value)} />
                      <button onClick={handleHostCreate} disabled={loading || !myProfile || !user} className="w-full bg-indigo-600 py-5 rounded-2xl font-black text-[10px] uppercase tracking-[0.3em] hover:bg-indigo-500 disabled:opacity-30 shadow-xl shadow-indigo-600/20 active:scale-95 transition-all">Create Terminal</button>
                    </div>
                    <div className="p-8 bg-emerald-500/5 rounded-[2.8rem] border border-emerald-500/10">
                      <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-6 px-1">Join Existing</p>
                      <input placeholder="000 000" className="w-full bg-slate-900/60 border border-slate-800 rounded-2xl px-6 py-5 text-center text-2xl font-black tracking-[0.5em] mb-5 outline-none focus:ring-2 focus:ring-emerald-500/40" value={meetingCode} maxLength={6} onChange={(e) => setMeetingCode(e.target.value.replace(/\D/g, ''))} />
                      <button onClick={() => handleJoinRoom()} disabled={loading || !myProfile} className="w-full bg-emerald-600 py-5 rounded-2xl font-black text-[10px] uppercase tracking-[0.3em] hover:bg-emerald-500 disabled:opacity-30 active:scale-95 transition-all">Link To Terminal</button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-8 space-y-16">
                {user && (
                  <div className="space-y-16">
                    {hostHistory.length > 0 && (
                      <section>
                        <h3 className="text-[11px] font-black text-indigo-400 uppercase tracking-[0.4em] mb-10 px-4">Proprietary Terminals</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                          {hostHistory.map(h => (
                            <button key={h.code} onClick={() => handleJoinRoom(h.code)} className="p-10 bg-slate-900/40 border border-white/5 rounded-[3rem] hover:border-white/20 hover:bg-slate-900 transition-all text-left shadow-xl group">
                              <p className="text-2xl font-black group-hover:text-white transition-colors">{h.name}</p>
                              <div className="flex items-center gap-3 mt-4">
                                <span className="text-[10px] text-indigo-400 font-black uppercase tracking-widest">CODE: {h.code}</span>
                                <span className="w-1 h-1 rounded-full bg-slate-700"></span>
                                <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest">OWNER</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      </section>
                    )}
                    {participantHistory.length > 0 && (
                      <section>
                        <h3 className="text-[11px] font-black text-emerald-400 uppercase tracking-[0.4em] mb-10 px-4">Shared Terminals</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                          {participantHistory.map(h => (
                            <button key={h.code} onClick={() => handleJoinRoom(h.code)} className="p-10 bg-slate-900/40 border border-white/5 rounded-[3rem] hover:border-emerald-500/30 transition-all text-left group shadow-xl">
                              <p className="text-2xl font-black group-hover:text-emerald-400 transition-colors">{h.name}</p>
                              <p className="text-[10px] text-slate-500 font-black mt-4 uppercase tracking-widest">CODE: {h.code}</p>
                            </button>
                          ))}
                        </div>
                      </section>
                    )}
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
             <button 
               onClick={copyInviteLink} 
               className={`flex items-center gap-3 px-6 py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all border ${copySuccess ? 'bg-emerald-500 text-white border-emerald-400' : 'bg-white text-black border-white hover:bg-slate-200'}`}
             >
               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
               {copySuccess ? 'Link Copied' : 'Invite Members'}
             </button>

             {role === 'host' && (
               <button 
                 onClick={handleDeleteMeeting} 
                 disabled={loading}
                 className="px-6 py-3.5 bg-red-500/10 text-red-500 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] border border-red-500/20 hover:bg-red-500 hover:text-white transition-all disabled:opacity-30"
               >
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
