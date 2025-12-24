
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

/**
 * RECOMMENDED SUPABASE RLS POLICIES:
 * ---------------------------------
 * Table: meetings
 * 
 * 1. SELECT: "Anyone can view by code"
 *    USING: (true) 
 * 
 * 2. INSERT: "Authenticated users can create"
 *    WITH CHECK: (auth.role() = 'authenticated')
 * 
 * 3. UPDATE: "Host or authenticated user can update"
 *    USING: ((data ->> 'hostId'::text) = (auth.uid())::text OR auth.role() = 'authenticated')
 * 
 * 4. DELETE: "Only host can delete"
 *    USING: ((data ->> 'hostId'::text) = (auth.uid())::text)
 */

const SUPABASE_URL = 'https://mitphvsxzgwxvtshpgqw.supabase.co'; 
const SUPABASE_KEY = 'sb_publishable_GSAUyX-e1wAaeYDnQ3aEYg_BVXW9L09';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export const dbService = {
  async signInWithLinkedIn() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) sessionStorage.setItem('lm_pending_room', room);

    if (window.location.hash) {
      sessionStorage.setItem('lm_pending_hash', window.location.hash);
    } else {
      sessionStorage.setItem('lm_pending_hash', '#/app/linkpro');
    }

    const redirectTo = window.location.origin + '/';

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'linkedin_oidc',
      options: {
        redirectTo: redirectTo,
        scopes: 'openid profile email'
      }
    });
    
    if (error) {
      console.error("Supabase OAuth Error:", error);
      throw error;
    }
    
    if (data?.url) {
      window.location.assign(data.url);
    }
  },

  async signOut() {
    try {
      const signoutPromise = supabase.auth.signOut();
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Signout timeout")), 2000));
      await Promise.race([signoutPromise, timeoutPromise]);
    } catch (e) {
      console.warn("Graceful signout warning:", e);
    } finally {
      localStorage.clear();
      sessionStorage.clear();
      window.location.hash = '';
      window.location.reload();
    }
  },

  async createMeeting(name: string, hostId: string): Promise<string> {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    const { error } = await supabase.from('meetings').insert({
      id: code,
      name: name,
      data: { participants: [], hostId: hostId },
      status: 'active'
    });

    if (error) {
      console.error("Supabase Insert Error:", error);
      throw new Error(error.message || "Failed to initialize room database record.");
    }
    
    return code;
  },

  async deleteMeeting(code: string, userId: string) {
    const { data: rows, error: fetchError } = await supabase
      .from('meetings')
      .select('data')
      .eq('id', code)
      .limit(1);

    if (fetchError || !rows || rows.length === 0) throw new Error("Meeting not found");

    const meetingData = rows[0].data as any;
    if (String(meetingData.hostId) !== String(userId)) {
      throw new Error("Only the host can delete this board.");
    }

    const { error: deleteError } = await supabase
      .from('meetings')
      .delete()
      .eq('id', code);

    if (deleteError) throw deleteError;
    return true;
  },

  async joinMeeting(code: string, profile: any, userId: string) {
    const { data: rows, error: fetchError } = await supabase
      .from('meetings')
      .select('data')
      .eq('id', code)
      .limit(1);

    if (fetchError || !rows || rows.length === 0) {
      throw new Error("Meeting room not found.");
    }

    const meetingData = rows[0].data as any;
    const participants = meetingData?.participants || [];
    
    let updatedParticipants;
    const existingIndex = participants.findIndex((p: any) => String(p.userId || p.id) === String(userId));
    
    if (existingIndex > -1) {
      updatedParticipants = [...participants];
      updatedParticipants[existingIndex] = { ...profile, userId };
    } else {
      updatedParticipants = [...participants, { ...profile, userId }];
    }

    const { error: updateError } = await supabase
      .from('meetings')
      .update({ data: { ...meetingData, participants: updatedParticipants } })
      .eq('id', code);
      
    if (updateError) throw new Error(`Sync failed: ${updateError.message}`);
    return true;
  },

  async removeParticipant(code: string, userId: string) {
    const { data: rows, error: fetchError } = await supabase
      .from('meetings')
      .select('data')
      .eq('id', code)
      .limit(1);

    if (fetchError || !rows || rows.length === 0) throw new Error("Meeting not found");

    const meetingData = rows[0].data as any;
    const participants = meetingData?.participants || [];
    const updatedParticipants = participants.filter((p: any) => String(p.userId || p.id) !== String(userId));
    
    const { error: updateError } = await supabase
      .from('meetings')
      .update({ data: { ...meetingData, participants: updatedParticipants } })
      .eq('id', code);
      
    if (updateError) throw updateError;
    return true;
  },

  async getMeeting(code: string) {
    try {
      const { data: rows, error } = await supabase
        .from('meetings')
        .select('*')
        .eq('id', code)
        .limit(1);
      if (error || !rows || rows.length === 0) return null;
      const record = rows[0];
      return {
        id: record.id,
        name: record.name,
        participants: (record.data as any).participants || [],
        hostId: (record.data as any).hostId,
        status: record.status
      };
    } catch (e) {
      console.error("getMeeting error", e);
      return null;
    }
  },

  async getHostedMeetings(userId: string) {
    try {
      // Use direct JSONB path filtering for better performance with RLS
      const { data, error } = await supabase
        .from('meetings')
        .select('id, name, status, created_at')
        .filter('data->>hostId', 'eq', userId)
        .order('created_at', { ascending: false });
      
      if (error) return [];
      return data.map(m => ({ 
        code: m.id, 
        name: m.name, 
        status: m.status,
        timestamp: new Date(m.created_at).getTime() 
      }));
    } catch (e) {
      return [];
    }
  },

  async getParticipatedMeetings(userId: string) {
    try {
      const { data, error } = await supabase
        .from('meetings')
        .select('id, name, data, status, created_at')
        .order('created_at', { ascending: false });
      if (error) return [];
      
      // Local filtering for participated meetings to handle JSONB array logic
      return data
        .filter(m => (m.data as any).participants?.some((p: any) => String(p.userId || p.id) === String(userId)))
        .map(m => ({
          code: m.id,
          name: m.name,
          status: m.status,
          timestamp: new Date(m.created_at).getTime()
        }));
    } catch (e) {
      return [];
    }
  }
};
