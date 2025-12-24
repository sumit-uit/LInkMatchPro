
import { Profile } from "../types";

/**
 * BadgeService provides a way to exchange professional cards without a database.
 * It encodes profile data into a URL-safe base64 string.
 */
export const BadgeService = {
  /**
   * Encodes a profile into a URL-safe string
   */
  encodeProfile(profile: Profile): string {
    const data = JSON.stringify({
      n: profile.name,
      h: profile.headline,
      a: profile.about,
      i: profile.interests,
      s: profile.skills,
      u: profile.linkedinUrl,
      id: profile.id,
      t: profile.lastUpdated
    });
    // Use btoa for basic encoding, wrapping in try-catch for unicode
    try {
      return btoa(unescape(encodeURIComponent(data)));
    } catch (e) {
      return btoa(data);
    }
  },

  /**
   * Decodes a profile from a string
   */
  decodeProfile(encoded: string): Profile | null {
    try {
      const decoded = decodeURIComponent(escape(atob(encoded)));
      const p = JSON.parse(decoded);
      return {
        id: p.id,
        name: p.n,
        headline: p.h,
        about: p.a,
        interests: p.i,
        skills: p.s,
        linkedinUrl: p.u,
        lastUpdated: p.t || Date.now(),
        imageUrl: `https://picsum.photos/seed/${p.n}/200`
      };
    } catch (e) {
      console.error("Failed to decode badge:", e);
      return null;
    }
  },

  /**
   * Generates the full shareable link
   */
  getShareLink(profile: Profile): string {
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}?badge=${this.encodeProfile(profile)}`;
  }
};
