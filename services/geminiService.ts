
import { GoogleGenAI } from "@google/genai";
import { Profile, NetworkingSynergy, ProfileSource } from "../types";

const hashString = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
};

/**
 * Resiliently extracts JSON from a string that might contain markdown, citations, or conversational text.
 */
function extractJson(text: string): any {
  if (!text) return null;
  
  let cleanText = text.trim();
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```[a-z]*\n/i, '').replace(/\n```$/g, '');
  }

  try {
    return JSON.parse(cleanText);
  } catch (e) {
    const firstBrace = cleanText.indexOf('{');
    const firstBracket = cleanText.indexOf('[');
    let start = -1;
    let end = -1;

    if (firstBrace !== -1 && (firstBracket === -1 || (firstBrace < firstBracket))) {
      start = firstBrace;
      end = cleanText.lastIndexOf('}');
    } else if (firstBracket !== -1) {
      start = firstBracket;
      end = cleanText.lastIndexOf(']');
    }

    if (start !== -1 && end !== -1 && end > start) {
      const potentialJson = cleanText.substring(start, end + 1);
      try {
        return JSON.parse(potentialJson);
      } catch (innerE) {
        console.error("Partial JSON match failed to parse:", innerE);
      }
    }
    
    throw new Error("Could not extract valid JSON from response");
  }
}

/**
 * Direct enrichment using Gemini 3 Flash. 
 * Using 'gemini-3-flash-preview' for better rate limits and speed.
 */
export const enrichProfile = async (url: string): Promise<Profile> => {
  // Guidelines: Always create a new GoogleGenAI instance right before making an API call.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const profileId = hashString(url);
  const slug = url.split('/in/')[1]?.split('/')[0]?.replace(/[-_0-9]/g, ' ').trim() || '';
  const searchName = slug.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  try {
    const prompt = `
      Task: Create a professional profile for the person at this URL: ${url}
      
      Instructions:
      1. Use Google Search to find professional information about this individual.
      2. Return a JSON object with: 'name', 'headline', 'about', 'skills' (array), and 'interests' (array).
      3. Focus on current professional expertise.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", 
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.1,
      },
    });

    const data = extractJson(response.text || '');
    if (!data) throw new Error("No data found");

    // Extract Grounding URLs for attribution
    const sources: ProfileSource[] = [];
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (chunks) {
      chunks.forEach((chunk: any) => {
        if (chunk.web?.uri) {
          sources.push({
            title: chunk.web.title || "Source",
            uri: chunk.web.uri
          });
        }
      });
    }

    return {
      id: profileId,
      name: data.name || searchName || "Professional Member",
      headline: data.headline || "Industry Professional",
      about: data.about || "A professional focused on networking and collaboration.",
      skills: Array.isArray(data.skills) ? data.skills : ["Business Development"],
      interests: Array.isArray(data.interests) ? data.interests : ["Innovation"],
      linkedinUrl: url,
      imageUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${profileId}`,
      lastUpdated: Date.now(),
      sources: sources.length > 0 ? sources : undefined
    };
  } catch (error: any) {
    console.error("Enrichment error:", error);
    return {
      id: profileId,
      name: searchName || "LinkedIn Member",
      headline: "Network Member",
      about: "Information currently limited due to system load. Connect to learn more about this member's background.",
      skills: ["Networking"],
      interests: ["Tech"],
      linkedinUrl: url,
      imageUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${profileId}`,
      lastUpdated: Date.now()
    };
  }
};

/**
 * Analyzes professional synergies using Gemini 3 Flash.
 */
export const analyzeRoomSynergies = async (profiles: Profile[]): Promise<NetworkingSynergy[]> => {
  if (profiles.length < 2) return [];
  
  // Guidelines: Always create a new GoogleGenAI instance right before making an API call.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const processingLimit = 15;
    const targetProfiles = profiles.slice(0, processingLimit);

    const simplifiedProfiles = targetProfiles.map(p => ({
      id: String(p.id),
      name: p.name,
      headline: p.headline,
      skills: p.skills,
      interests: p.interests
    }));

    const prompt = `
      Task: Perform networking synergy analysis.
      Participants: ${JSON.stringify(simplifiedProfiles)}
      
      Output: A JSON array of match objects:
      {
        "pair": ["id1", "id2"],
        "reason": "short explanation of why they should talk",
        "topic": "ice breaker question",
        "strength": 0-100
      }
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });
    
    const results = extractJson(response.text || '[]');
    return Array.isArray(results) ? results : [];
  } catch (error) {
    console.error("Synergy Error:", error);
    return [];
  }
};
